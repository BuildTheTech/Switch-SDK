"""
Switch DEX Aggregator — Complete Swap Example (web3.py)

Demonstrates the full swap lifecycle:
  1. Fetch adapters (optional — for DEX filtering)
  2. Check token taxes (determines feeOnOutput mode)
  3. Get quote with exact expectedOutputAmount
  4. Approve ERC-20 (if needed)
  5. Send swap transaction

Usage:
    pip install web3 requests
    export SWITCH_API_KEY=your_key
    export PRIVATE_KEY=your_private_key
    python examples/swap-web3py.py

Prerequisites:
    pip install web3 requests
"""

import os
import sys
import requests
from web3 import Web3

# ── Constants --

API_BASE = "https://quote.switch.win"
SWITCH_ROUTER = "0x69033829f50244FD1be7BDC8e74aE0fF97E47126"
NATIVE_PLS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
WPLS = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"
RPC_URL = os.environ.get("RPC_URL", "https://rpc.pulsechain.com")

ERC20_ABI = [
    {
        "constant": True,
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "type": "function",
    },
]

# ── Configuration --

API_KEY = os.environ.get("SWITCH_API_KEY")
PRIVATE_KEY = os.environ.get("PRIVATE_KEY")

if not API_KEY:
    print("Error: Set SWITCH_API_KEY env var")
    sys.exit(1)
if not PRIVATE_KEY:
    print("Error: Set PRIVATE_KEY env var")
    sys.exit(1)

# ── Swap parameters --

FROM_TOKEN = "0xA1077a294dDE1B09bB078844df40758a5D0f9a27"  # WPLS
TO_TOKEN = "0x95B303987A60C71504D99Aa1b13B4DA07b0790ab"  # PLSX
AMOUNT = 1000 * 10**18  # 1000 WPLS in wei
SLIPPAGE_BPS = 100  # 1%
FEE_BPS = 30  # 0.30%
PARTNER_ADDRESS = None  # your partner wallet or None
RECEIVER_ADDRESS = None  # custom recipient address or None to send to sender


# ── Helpers --

def api_fetch(path: str, params: dict | None = None) -> dict:
    """Make an authenticated API call to Switch."""
    resp = requests.get(
        f"{API_BASE}{path}",
        params=params,
        headers={"x-api-key": API_KEY},
    )
    resp.raise_for_status()
    return resp.json()


def determine_fee_on_output(
    from_token: str,
    to_token: str,
    from_tax: dict,
    to_tax: dict,
) -> bool:
    """Determine feeOnOutput based on tax info and PLS involvement.

    - Selling a tax token → fee on output (avoid triggering sell-tax on fee)
    - Buying a tax token  → fee on input  (avoid triggering buy-tax on fee)
    - Buying PLS/WPLS     → fee on output (collect PLS)
    - Selling PLS/WPLS    → fee on input  (collect PLS)
    - Default             → False
    """
    pls_addresses = [NATIVE_PLS.lower(), WPLS.lower()]
    from_addr = from_token.lower()
    to_addr = to_token.lower()

    if from_tax.get("isTaxToken") and from_tax.get("sellTaxBps", 0) > 0:
        return True
    if to_tax.get("isTaxToken") and to_tax.get("buyTaxBps", 0) > 0:
        return False
    if to_addr in pls_addresses:
        return True
    if from_addr in pls_addresses:
        return False
    return False


def swap(
    w3: Web3,
    account,
    from_token: str,
    to_token: str,
    amount_wei: int,
    slippage_bps: int = 50,
    fee_bps: int = 0,
    partner: str | None = None,
    receiver: str | None = None,
):
    """Execute a full swap: adapters → checkTax → quote → approve → send."""
    sender = account.address
    print(f"Sender: {sender}")
    print(f"Swapping {amount_wei} wei of {from_token} → {to_token}")

    # ── Step 1: Fetch available adapters (optional — cache this) ─
    print("\n── Step 1: Fetching adapters ──")
    adapters_data = api_fetch("/swap/adapters")
    adapter_names = [a["name"] for a in adapters_data["adapters"]]
    print(f"Available DEXes: {', '.join(adapter_names)}")

    # ── Step 2: Check token taxes --
    print("\n── Step 2: Checking token taxes ──")
    from_tax = api_fetch("/swap/checkTax", {"token": from_token, "network": "pulsechain"})
    to_tax = api_fetch("/swap/checkTax", {"token": to_token, "network": "pulsechain"})

    if from_tax.get("isTaxToken"):
        print(f"From token: TAX (sell={from_tax['sellTaxBps']}bps, buy={from_tax['buyTaxBps']}bps)")
    else:
        print("From token: not a tax token")

    if to_tax.get("isTaxToken"):
        print(f"To token:   TAX (sell={to_tax['sellTaxBps']}bps, buy={to_tax['buyTaxBps']}bps)")
    else:
        print("To token:   not a tax token")

    # ── Determine fee mode --
    fee_on_output = determine_fee_on_output(from_token, to_token, from_tax, to_tax)
    print(f"Fee mode: fee on {'output' if fee_on_output else 'input'}")

    # ── Step 3: Fetch quote --
    print("\n── Step 3: Fetching quote ──")
    params = {
        "network": "pulsechain",
        "from": from_token,
        "to": to_token,
        "amount": str(amount_wei),
        "sender": sender,
        "slippage": str(slippage_bps),
        "feeOnOutput": str(fee_on_output).lower(),
    }
    if fee_bps:
        params["fee"] = str(fee_bps)
    if partner:
        params["partnerAddress"] = partner
    if receiver:
        params["receiver"] = receiver

    quote = api_fetch("/swap/quote", params)

    if "error" in quote:
        raise Exception(f"Quote error: {quote['error']}")

    tx_data = quote.get("tx")
    tx_data_fee_on_output = quote.get("txFeeOnOutput")
    if not tx_data:
        raise Exception("No tx object in response — did you provide sender?")

    # Choose the matching tx variant for the fee mode we determined
    chosen_tx = tx_data_fee_on_output if fee_on_output and tx_data_fee_on_output else tx_data

    print(f"Raw DEX output:    {quote['totalAmountOut']}")
    print(f"Expected received: {quote['expectedOutputAmount']}")
    print(f"Min output:        {quote['minAmountOut']}")
    print(f"Eff. slippage:     {quote['effectiveSlippagePercent']}%")
    print(f"Paths:             {len(quote['paths'])}")

    # ── Step 4: Approve ERC-20 if needed --
    if from_token.lower() != NATIVE_PLS.lower():
        token = w3.eth.contract(
            address=Web3.to_checksum_address(from_token), abi=ERC20_ABI
        )
        current_allowance = token.functions.allowance(
            sender, chosen_tx["to"]
        ).call()

        if current_allowance < amount_wei:
            print("\nApproving SwitchRouter to spend tokens...")
            approve_tx = token.functions.approve(
                chosen_tx["to"], amount_wei
            ).build_transaction(
                {
                    "from": sender,
                    "nonce": w3.eth.get_transaction_count(sender),
                }
            )
            signed = account.sign_transaction(approve_tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
            print(f"Approved in tx: {receipt['transactionHash'].hex()}")
        else:
            print("\nSufficient allowance already granted")

    # ── Step 5: Send swap --
    print("\nSending swap transaction...")
    swap_tx = {
        "from": sender,
        "to": Web3.to_checksum_address(chosen_tx["to"]),
        "data": chosen_tx["data"],
        "value": int(chosen_tx["value"]),
        "nonce": w3.eth.get_transaction_count(sender),
    }

    signed = account.sign_transaction(swap_tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"Tx hash: {tx_hash.hex()}")

    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"\nSwap confirmed in block {receipt['blockNumber']}")
    return receipt


def main():
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not w3.is_connected():
        print("Error: Could not connect to RPC")
        sys.exit(1)

    account = w3.eth.account.from_key(PRIVATE_KEY)

    swap(
        w3=w3,
        account=account,
        from_token=FROM_TOKEN,
        to_token=TO_TOKEN,
        amount_wei=AMOUNT,
        slippage_bps=SLIPPAGE_BPS,
        fee_bps=FEE_BPS,
        partner=PARTNER_ADDRESS,
        receiver=RECEIVER_ADDRESS,
    )


if __name__ == "__main__":
    main()
