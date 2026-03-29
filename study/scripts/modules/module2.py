import hashlib
import hmac
import struct
from mnemonic import Mnemonic
from coincurve import PublicKey
from eth_hash.auto import keccak

def derive_child(parent_privkey, chain_code, index, hardened=False):
    if hardened:
        data = b'\x00' + parent_privkey + struct.pack('>I', index + 0x80000000)
    else:
        parent_pubkey = PublicKey.from_valid_secret(parent_privkey).format(compressed=True)
        data = parent_pubkey + struct.pack('>I', index)
    raw = hmac.new(chain_code, data, hashlib.sha512).digest()
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    child_privkey = (int.from_bytes(raw[:32], 'big') + int.from_bytes(parent_privkey, 'big')) % n
    return child_privkey.to_bytes(32, 'big'), raw[32:]

def seed_phrase_to_address(seed_phrase):
    # Шаг 1: seed-фраза → master seed
    mnemo = Mnemonic("english")
    master_seed = mnemo.to_seed(seed_phrase, passphrase="")

    # Шаг 2: master seed → master private key + chain code
    raw = hmac.new(b"Bitcoin seed", master_seed, hashlib.sha512).digest()
    key, chain = raw[:32], raw[32:]

    # Шаг 3: деривация пути m/44'/60'/0'/0/0
    key, chain = derive_child(key, chain, 44, hardened=True)
    key, chain = derive_child(key, chain, 60, hardened=True)
    key, chain = derive_child(key, chain, 0,  hardened=True)
    key, chain = derive_child(key, chain, 0,  hardened=False)
    key, chain = derive_child(key, chain, 0,  hardened=False)

    # Шаг 4: private key → public key
    pubkey_bytes = PublicKey.from_valid_secret(key).format(compressed=False)[1:]

    # Шаг 5: public key → Ethereum адрес
    address = "0x" + keccak(pubkey_bytes)[-20:].hex()

    return key.hex(), address

privkey, address = seed_phrase_to_address("stuff trophy fault cigar credit bus cliff rack drill coast math rate")
print("Private key:", privkey)
print("Address:    ", address)