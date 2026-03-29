import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..'))

from web3 import Web3
from config import ALCHEMY_URL

# Подключение к Sepolia
w3 = Web3(Web3.HTTPProvider(ALCHEMY_URL))
print("Подключён:", w3.is_connected())

# Твой приватный ключ и адрес
private_key = "745b94e0b0cfcf1e603a4ed7dc93f4c4b78b7f17886dcc588f42ab93d301d586"
my_address  = w3.eth.account.from_key(private_key).address
print("Адрес:", my_address)

# Получаем актуальный nonce из сети
nonce = w3.eth.get_transaction_count(my_address)
print("Nonce:", nonce)

to = "0xC43186a3401B8c185748467a8C169C1f2368BED6"

# Формируем транзакцию
transaction = {
    'to':       Web3.to_checksum_address(to),
    'value':    w3.to_wei(0.001, 'ether'),  # 0.001 тестового ETH
    'gas':      21000,
    'gasPrice': w3.eth.gas_price,           # актуальная цена газа из сети
    'nonce':    nonce,
    'chainId':  11155111                    # Sepolia
}

# Подписываем
signed = w3.eth.account.sign_transaction(transaction, private_key)

# Отправляем в сеть
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
print("TX hash:", tx_hash.hex())
print("Смотри на: https://sepolia.etherscan.io/tx/" + tx_hash.hex())
print('Адрес получателя:', to)