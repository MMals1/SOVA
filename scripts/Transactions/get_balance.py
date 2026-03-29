from web3 import Web3
from config import ALCHEMY_URL

_w3 = Web3(Web3.HTTPProvider(ALCHEMY_URL))


def get_balance(address: str) -> float:
    balance_wei = _w3.eth.get_balance(Web3.to_checksum_address(address))
    return float(_w3.from_wei(balance_wei, "ether"))


def get_nonce(address: str) -> int:
    return _w3.eth.get_transaction_count(Web3.to_checksum_address(address))
