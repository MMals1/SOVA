import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from eth_hash.auto import keccak
from study_getPub import pubkey

# Берём несжатый публичный ключ без первого байта 04
pubkey_bytes = pubkey.format(compressed=False)[1:]  # 64 байта

# Keccak-256 хэш
keccak_hash = keccak(pubkey_bytes)
print("Keccak hash:", keccak_hash.hex())

# Ethereum адрес = последние 20 байт
address = keccak_hash[-20:]
print("Адрес:", "0x" + address.hex())