from scripts.Accounts.wallet import create_wallet, load_all_wallets, update_wallet
from scripts.Transactions.get_balance import get_balance, get_nonce
from scripts.Transactions.send_transaction import send_transaction


def main():
    PASSWORD = "mypassword123"

    # Создаём два кошелька
    wallet1 = create_wallet(PASSWORD)
    wallet2 = create_wallet(PASSWORD)

    print("=== Кошелёк 1 ===")
    print("Address:  ", wallet1.address)
    print("Balance:  ", get_balance(wallet1.address), "ETH")

    print("\n=== Кошелёк 2 ===")
    print("Address:  ", wallet2.address)
    print("Balance:  ", get_balance(wallet2.address), "ETH")

    # Пример отправки транзакции (раскомментировать когда на кошельке будет баланс):
    # tx_hash = send_transaction(
    #     private_key=wallet1.private_key,
    #     to_address=wallet2.address,
    #     amount_eth=0.001,
    # )
    # print("\nТранзакция отправлена:", tx_hash)
    # print("Смотри: https://sepolia.etherscan.io/tx/" + tx_hash)

    # Обновляем nonce и баланс после транзакции
    # wallet1.nonce = get_nonce(wallet1.address)
    # wallet1.balance = get_balance(wallet1.address)
    # update_wallet(wallet1)

    print(f"\nВсего кошельков: {len(load_all_wallets())}")


if __name__ == "__main__":
    main()

