/// <reference path="sw-globals.d.ts" />
'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// sw-rpc.ts — JSON-RPC envelope helpers + read-only RPC proxy
// Depends on: sw-wallet.ts (for getActiveNetworkParams)
// ═══════════════════════════════════════════════════════════════════════════

interface RpcResultEnvelope {
  id: unknown;
  result: unknown;
}

interface RpcErrorEnvelope {
  id: unknown;
  error: { code: number; message: string; data?: unknown };
}

function rpcResult(id: unknown, result: unknown): RpcResultEnvelope {
  return { id, result };
}

function rpcError(id: unknown, code: number, message: string, data?: unknown): RpcErrorEnvelope {
  const err: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) err.data = data;
  return { id, error: err };
}

// ── Read-only RPC proxy ───────────────────────────────────────────────────
async function proxyRpc(method: string, params: unknown[]): Promise<unknown> {
  const { rpcUrl, chainId } = await getActiveNetworkParams();
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  try {
    return await provider.send(method, params);
  } catch (err) {
    const e = new Error((err as Error).message || 'RPC error') as Error & { code: number };
    e.code = -32603;
    throw e;
  }
}
