import hashlib
import hmac
import struct
from mnemonic import Mnemonic
from coincurve import PublicKey

# Шаг 1: seed-фраза → master seed
mnemo = Mnemonic("english")
seed_phrase = "твои 12 слов здесь"
master_seed = mnemo.to_seed(seed_phrase, passphrase="")

# Шаг 2: master seed → master private key + chain code
raw = hmac.new(b"Bitcoin seed", master_seed, hashlib.sha512).digest()
master_privkey = raw[:32]
master_chain   = raw[32:]

print("Master private key:", master_privkey.hex())
print("Master chain code: ", master_chain.hex())