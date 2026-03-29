import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from web3 import Web3
from eth_account import Account
from config import ALCHEMY_URL

class EthWallet:
    def __init__(self, seed_phrase, rpc_url=ALCHEMY_URL):
        Account.enable_unaudited_hdwallet_features()
        self.account = Account.from_mnemonic(seed_phrase, account_path="m/44'/60'/0'/0/0")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))

    @property
    def address(self):
        return self.account.address

    @property
    def private_key(self):
        return self.account.key.hex()

    def get_balance(self):
        balance_wei = self.w3.eth.get_balance(self.address)
        return self.w3.from_wei(balance_wei, 'ether')

    def send_eth(self, to_address, amount_ether):
        transaction = {
            'to':       Web3.to_checksum_address(to_address),
            'value':    self.w3.to_wei(amount_ether, 'ether'),
            'gas':      21000,
            'gasPrice': self.w3.eth.gas_price,
            'nonce':    self.w3.eth.get_transaction_count(self.address),
            'chainId':  11155111
        }
        signed   = self.w3.eth.account.sign_transaction(transaction, self.account.key)
        tx_hash  = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        return tx_hash.hex()

# Использование
wallet = EthWallet(
    seed_phrase = "resist champion desert rate budget calm member live bounce dignity sustain label",
    rpc_url     = "https://eth-sepolia.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p"
)

print("Адрес:  ", wallet.address)
print("Баланс: ", wallet.get_balance(), "ETH")

tx = wallet.send_eth("0xC43186a3401B8c185748467a8C169C1f2368BED6", 0.001)
print("TX:", tx)
print("https://sepolia.etherscan.io/tx/" + tx)