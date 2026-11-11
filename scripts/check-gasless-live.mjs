/** Explicit read-only smoke check. No signer, private key, POST, or transaction broadcast. */
import { JsonRpcProvider } from "ethers";
import { GaslessSwapClient } from "../dist/gasless-client.js";
import { GASLESS_DEPLOYMENTS, readGaslessChainState } from "../dist/gasless.js";

const rpc = {
  pulsechain: process.env.PULSECHAIN_RPC_URL ?? "https://rpc.pulsechain.com",
  robinhood:
    process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
};
const maker = "0xf3b5e21b1916af651278666a18128b8245b7ead4";
const results = [];
for (const network of ["pulsechain", "robinhood"]) {
  const provider = new JsonRpcProvider(rpc[network], undefined, {
    batchMaxCount: 10,
  });
  const client = new GaslessSwapClient({
    network,
    provider,
    // Public frontend proxy attaches its API credentials server-side.
    quoteEndpoint: "https://beta.switch.win/api/swap/quote",
    taxEndpoint: "https://beta.switch.win/api/swap/checkTax",
  });
  try {
    const config = await client.getConfig();
    console.log(
      JSON.stringify({
        network,
        check: "config",
        contract: config.gaslessContract,
        version: config.gaslessSettlementVersion,
        feeBps: config.gaslessProtocolFeeBps,
        capBps: config.gaslessMaxOperatorPayoutBps,
      }),
    );
    const state = await Promise.race([
      readGaslessChainState(provider, GASLESS_DEPLOYMENTS[network]),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error("RPC timeout")), 20000);
        t.unref();
      }),
    ]);
    console.log(
      JSON.stringify({
        network,
        check: "on-chain-policy",
        block: state.blockNumber,
        passed: true,
      }),
    );
    results.push({ network, check: "on-chain-policy", passed: true });
    if (process.argv.includes("--quotes")) {
      const trades =
        network === "pulsechain"
          ? [
              {
                label: "SWITCH-USDC",
                tokenIn: "0x357d80ea5dc53999da7da747e7afebc02fe276fb",
                tokenOut: "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",
                amountIn: "64411401494724021134547",
              },
              {
                label: "small-USDC-HEX",
                tokenIn: "0x15d38573d2feeb82e7ad5187ab8c1d52810b1f07",
                tokenOut: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
                amountIn: "10000",
              },
              {
                label: "HEX-VOUCH-tax",
                tokenIn: "0x2b591e99afe9f32eaa6214f7b7629768c40eeb39",
                tokenOut: "0xd34f5adc24d8cc55c1e832bdf65fffdf80d1314f",
                amountIn: "10000000000000",
              },
            ]
          : [
              {
                label: "WETH-USDG",
                tokenIn: GASLESS_DEPLOYMENTS.robinhood.wrappedNative,
                tokenOut: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
                amountIn: "10000000000000000",
              },
            ];
      for (const { label, ...trade } of trades) {
        const started = Date.now();
        const decision = await client.quote({ ...trade, maker });
        const result = {
          network,
          check: label,
          eligible: decision.eligible,
          elapsedMs: Date.now() - started,
          ...(decision.eligibility
            ? {
                serverStatus: decision.eligibility.status,
                serverReasonCode: decision.eligibility.reasonCode,
                nativeSymbol: decision.eligibility.nativeSymbol,
                operatorPayoutNative:
                  decision.eligibility.economics?.operatorPayoutNative,
                conservativeReserveNative:
                  decision.eligibility.economics?.conservativeGasBudgetNative,
              }
            : {}),
          ...(decision.eligible
            ? {
                feeOnOutput: decision.prepared.feeOnOutput,
                minimum: decision.prepared.minAmountOut,
                nativePayout: decision.prepared.preview.operatorPayoutNative,
                nativeBudget: decision.prepared.gasBudgetNative,
              }
            : { code: decision.code, retryable: decision.retryable }),
        };
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
  } catch (error) {
    const result = {
      network,
      check: "on-chain-policy",
      passed: false,
      code: error?.code ?? "RPC_UNAVAILABLE",
    };
    results.push(result);
    console.log(JSON.stringify(result));
  } finally {
    provider.destroy();
  }
}
// Ineligible quotes can be the correct result; policy-read failures are smoke-test failures.
if (results.some((result) => result.passed === false)) process.exitCode = 1;
