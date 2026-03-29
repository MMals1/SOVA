import os
import hashlib
from mnemonic import Mnemonic

# Шаг 1: энтропия
entropy = os.urandom(16)

# Шаг 2: контрольная сумма
checksum = hashlib.sha256(entropy).digest()[0] >> 4

# Шаг 3: склеиваем
combined = (int.from_bytes(entropy, 'big') << 4) | checksum

# Шаг 4: нарезаем на индексы
indices = []
for i in range(12):
    index = (combined >> (11 * (11 - i))) & 0x7FF
    indices.append(index)

# Шаг 5: достаём слова
mnemo = Mnemonic("english")
wordlist = mnemo.wordlist
phrase = []
for i in indices:
    phrase.append(wordlist[i])


master_seed = mnemo.to_seed(" ".join(phrase), passphrase="")

master_seed2 = hashlib.pbkdf2_hmac(
    hash_name  = 'sha512',
    password   = " ".join(phrase).encode('utf-8'),
    salt       = "mnemonic".encode('utf-8'),
    iterations = 2048,
    dklen      = 64
)


print("Seed фраза:", " ".join(phrase))

print("Master seed (hex):", master_seed.hex())

print("Master seed 2 (hex):", master_seed2.hex())