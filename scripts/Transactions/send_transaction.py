from web3 import Web3
from config import ALCHEMY_URL

_w3 = Web3(Web3.HTTPProvider(ALCHEMY_URL))


def send_transaction(private_key: str, to_address: str, amount_eth: float) -> str:
    account = _w3.eth.account.from_key(private_key)
    tx = {
        "to":       Web3.to_checksum_address(to_address),
        "value":    _w3.to_wei(amount_eth, "ether"),
        "gas":      21000,
        "gasPrice": _w3.eth.gas_price,
        "nonce":    _w3.eth.get_transaction_count(account.address),
        "chainId":  11155111,  # Sepolia
    }
    signed = _w3.eth.account.sign_transaction(tx, private_key)
    tx_hash = _w3.eth.send_raw_transaction(signed.raw_transaction)
    return "0x" + tx_hash.hex()
