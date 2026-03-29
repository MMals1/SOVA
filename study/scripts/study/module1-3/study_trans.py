from eth_account import Account
from web3 import Web3

Account.enable_unaudited_hdwallet_features()

seed_phrase = "swim april scan pledge project sting mimic oval visual measure deliver skull"
account = Account.from_mnemonic(seed_phrase, account_path="m/44'/60'/0'/0/0")

transaction = {
    'to':       Web3.to_checksum_address('0x742d35cc6634c0532925a3b8d4c9c0f6b5e8d4e9'),
    'value':    1000000000000000000,
    'gas':      21000,
    'gasPrice': 20000000000,
    'nonce':    0,
    'chainId':  11155111
}

signed = Account.sign_transaction(transaction, account.key)

print("Raw transaction:", signed.raw_transaction.hex())
print("Hash:           ", signed.hash.hex())
print("v:", signed.v)
print("r:", hex(signed.r))
print("s:", hex(signed.s))