import hashlib
import hmac
import struct
from mnemonic import Mnemonic
from coincurve import PublicKey

def derive_child(parent_privkey, chain_code, index, hardened=False):
    if hardened:
        data = b'\x00' + parent_privkey + struct.pack('>I', index + 0x80000000)
    else:
        parent_pubkey = PublicKey.from_valid_secret(parent_privkey).format(compressed=True)
        data = parent_pubkey + struct.pack('>I', index)

    raw = hmac.new(chain_code, data, hashlib.sha512).digest()

    # Складываем с родительским ключом по модулю n (кривая secp256k1)
    n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
    child_privkey = (int.from_bytes(raw[:32], 'big') + int.from_bytes(parent_privkey, 'big')) % n
    child_privkey = child_privkey.to_bytes(32, 'big')
    child_chain   = raw[32:]

    return child_privkey, child_chain

# Шаг 1: seed-фраза → master seed
mnemo = Mnemonic("english")
seed_phrase = "твои 12 слов здесь"
master_seed = mnemo.to_seed(seed_phrase, passphrase="")

# Шаг 2: master seed → master private key + chain code
raw = hmac.new(b"Bitcoin seed", master_seed, hashlib.sha512).digest()
key   = raw[:32]
chain = raw[32:]

# Шаг 3: деривация пути m/44'/60'/0'/0/0
key, chain = derive_child(key, chain, 44, hardened=True)
key, chain = derive_child(key, chain, 60, hardened=True)
key, chain = derive_child(key, chain, 0,  hardened=True)
key, chain = derive_child(key, chain, 0,  hardened=False)
key, chain = derive_child(key, chain, 0,  hardened=False)

print("Child private key:", key.hex())