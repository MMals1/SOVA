from coincurve import PublicKey

child_privkey = bytes.fromhex("cdb7166534ea4d44a2c7f0cf9bb28cb7ca647702b19281e8124f605cf6da6432")

# Вычисляем публичный ключ
pubkey = PublicKey.from_valid_secret(child_privkey)

# Два формата публичного ключа
# print("Сжатый (33 байта): ", pubkey.format(compressed=True).hex())
# print("Несжатый (65 байт):", pubkey.format(compressed=False).hex())