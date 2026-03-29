from eth_account import Account
from coincurve import PublicKey

Account.enable_unaudited_hdwallet_features()
seed_phrase = "stuff trophy fault cigar credit bus cliff rack drill coast math rate"
account = Account.from_mnemonic(seed_phrase, account_path="m/44'/60'/0'/0/0")

private_key = bytes.fromhex("71a1edd5d21de99abdcd708d65e699fb9af5f46d6dbf2f5ee42cdead9bba973b")

# Наш публичный ключ
our_pubkey = PublicKey.from_valid_secret(private_key).format(compressed=False)[1:]
print("Наш pubkey:      ", our_pubkey.hex())

# Публичный ключ из eth_account
their_pubkey = account._key_obj.public_key.to_bytes()
print("eth_account pubkey:", their_pubkey.hex())

# Адреса совпадают?
print("Адрес наш:      ", account.address)