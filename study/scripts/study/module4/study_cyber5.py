import os
import json
import uuid
import hashlib
from web3 import Web3
from eth_account import Account
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from eth_hash.auto import keccak
from mnemonic import Mnemonic
from coincurve import PublicKey
import struct
import hmac as hmac_module

def derive_child(parent_privkey, chain_code, index, hardened=False):
    if hardened:
        data = b'\x00' + parent_privkey + struct.pack('>I', index + 0x80000000)
    else:
        parent_pubkey = PublicKey.from_valid_secret(parent_privkey).format(compressed=True)
        data = parent_pubkey + struct.pack('>I', index)
    raw = hmac_module.new(chain_code, data, hashlib.sha512).digest()
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    child_privkey = (int.from_bytes(raw[:32], 'big') + int.from_bytes(parent_privkey, 'big')) % n
    return child_privkey.to_bytes(32, 'big'), raw[32:]

def seed_phrase_to_privkey(seed_phrase: str) -> bytes:
    master_seed = Mnemonic("english").to_seed(seed_phrase, passphrase="")
    raw = hmac_module.new(b"Bitcoin seed", master_seed, hashlib.sha512).digest()
    key, chain = raw[:32], raw[32:]
    key, chain = derive_child(key, chain, 44, hardened=True)
    key, chain = derive_child(key, chain, 60, hardened=True)
    key, chain = derive_child(key, chain, 0,  hardened=True)
    key, chain = derive_child(key, chain, 0,  hardened=False)
    key, chain = derive_child(key, chain, 0,  hardened=False)
    return key

def privkey_to_address(private_key: bytes) -> str:
    pubkey_bytes = PublicKey.from_valid_secret(private_key).format(compressed=False)[1:]
    return "0x" + keccak(pubkey_bytes)[-20:].hex()

def create_keystore(private_key: bytes, password: str) -> dict:
    password_bytes = password.encode('utf-8')
    salt = os.urandom(32)
    iv   = os.urandom(16)
    kdf  = Scrypt(salt=salt, length=32, n=262144, r=8, p=1, backend=default_backend())
    derived_key = kdf.derive(password_bytes)
    cipher = Cipher(algorithms.AES(derived_key[:16]), modes.CTR(iv), backend=default_backend())
    encryptor  = cipher.encryptor()
    ciphertext = encryptor.update(private_key) + encryptor.finalize()
    mac = keccak(derived_key[16:32] + ciphertext)
    return {
        "version": 3,
        "id": str(uuid.uuid4()),
        "address": privkey_to_address(private_key),
        "crypto": {
            "cipher": "aes-128-ctr",
            "cipherparams": {"iv": iv.hex()},
            "ciphertext": ciphertext.hex(),
            "kdf": "scrypt",
            "kdfparams": {"n": 262144, "r": 8, "p": 1, "dklen": 32, "salt": salt.hex()},
            "mac": mac.hex()
        }
    }

def decode_keystore(keystore: dict, password: str) -> bytes:
    password_bytes = password.encode('utf-8')
    params = keystore["crypto"]["kdfparams"]
    kdf = Scrypt(
        salt=bytes.fromhex(params["salt"]), length=params["dklen"],
        n=params["n"], r=params["r"], p=params["p"], backend=default_backend()
    )
    derived_key = kdf.derive(password_bytes)
    ciphertext  = bytes.fromhex(keystore["crypto"]["ciphertext"])
    mac = keccak(derived_key[16:32] + ciphertext)
    if mac.hex() != keystore["crypto"]["mac"]:
        raise ValueError("Неверный пароль!")
    iv = bytes.fromhex(keystore["crypto"]["cipherparams"]["iv"])
    cipher = Cipher(algorithms.AES(derived_key[:16]), modes.CTR(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    return decryptor.update(ciphertext) + decryptor.finalize()


class EthWallet:
    def __init__(self, private_key: bytes, rpc_url: str):
        self.private_key = private_key
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))

    @classmethod
    def from_seed_phrase(cls, seed_phrase: str, rpc_url: str) -> "EthWallet":
        private_key = seed_phrase_to_privkey(seed_phrase)
        return cls(private_key, rpc_url)

    @classmethod
    def from_keystore(cls, keystore_path: str, password: str, rpc_url: str) -> "EthWallet":
        with open(keystore_path, 'r') as f:
            keystore = json.load(f)
        private_key = decode_keystore(keystore, password)
        return cls(private_key, rpc_url)

    def save_keystore(self, password: str, path: str):
        keystore = create_keystore(self.private_key, password)
        with open(path, 'w') as f:
            json.dump(keystore, f, indent=2)
        print(f"Keystore сохранён: {path}")

    @property
    def address(self) -> str:
        return privkey_to_address(self.private_key)

    def get_balance(self) -> float:
        balance_wei = self.w3.eth.get_balance(Web3.to_checksum_address(self.address))
        return float(self.w3.from_wei(balance_wei, 'ether'))

    def send_eth(self, to_address: str, amount_ether: float) -> str:
        transaction = {
            'to':       Web3.to_checksum_address(to_address),
            'value':    self.w3.to_wei(amount_ether, 'ether'),
            'gas':      21000,
            'gasPrice': self.w3.eth.gas_price,
            'nonce':    self.w3.eth.get_transaction_count(
                            Web3.to_checksum_address(self.address)
                        ),
            'chainId':  11155111
        }
        signed  = self.w3.eth.account.sign_transaction(transaction, self.private_key)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return "0x" + tx_hash.hex()


# Использование
RPC_URL     = "https://eth-sepolia.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p"
SEED_PHRASE = "resist champion desert rate budget calm member live bounce dignity sustain label"

# Создаём кошелёк из seed-фразы и сохраняем keystore
wallet = EthWallet.from_seed_phrase(SEED_PHRASE, RPC_URL)
print("Адрес:  ", wallet.address)
print("Баланс: ", wallet.get_balance(), "ETH")
wallet.save_keystore("mypassword123", "wallet.json")

# Загружаем кошелёк из keystore
wallet2 = EthWallet.from_keystore("wallet.json", "mypassword123", RPC_URL)
print("\nЗагружен из keystore:")
print("Адрес:  ", wallet2.address)
print("Баланс: ", wallet2.get_balance(), "ETH")
print("Совпадает:", wallet.address == wallet2.address)