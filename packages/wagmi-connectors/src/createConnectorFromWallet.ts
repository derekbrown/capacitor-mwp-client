import type {
  AppMetadata,
  EIP1193Provider,
  Wallet,
} from "capacitor-mwp-client/client";
import {
  ChainNotConfiguredError,
  type Connector,
  createConnector,
} from "@wagmi/core";
import type { Omit } from "@wagmi/core/internal";
import {
  type AddEthereumChainParameter,
  getAddress,
  type Hex,
  numberToHex,
  type ProviderRpcError,
  SwitchChainError,
  UserRejectedRequestError,
} from "viem";

import { toCamelCase } from "./utils.js";

type WagmiWallet = Wallet & {
  wagmiType?: string;
  supportsSimulation?: boolean;
};

export type CreateConnectorParameters = {
  metadata: Omit<AppMetadata, "chainIds">;
  wallet: WagmiWallet;
};

export function createConnectorFromWallet(
  parameters: CreateConnectorParameters,
) {
  type Provider = EIP1193Provider;

  let walletProvider: Provider | undefined;

  let accountsChanged: Connector["onAccountsChanged"] | undefined;
  let chainChanged: Connector["onChainChanged"] | undefined;
  let disconnect: Connector["onDisconnect"] | undefined;

  const walletName = toCamelCase(parameters.metadata.name);

  return createConnector<Provider>((config) => ({
    id: walletName,
    name: walletName,
    supportsSimulation: parameters.wallet.supportsSimulation,
    type: parameters.wallet.wagmiType ?? walletName,
    async connect({ chainId } = {}) {
      try {
        const provider = await this.getProvider();
        const accounts = (
          (await provider.request({
            method: "eth_requestAccounts",
          })) as string[]
        ).map((x) => getAddress(x));

        if (!accountsChanged) {
          accountsChanged = this.onAccountsChanged.bind(this);
          provider.on("accountsChanged", accountsChanged);
        }
        if (!chainChanged) {
          chainChanged = this.onChainChanged.bind(this);
          provider.on("chainChanged", chainChanged);
        }
        if (!disconnect) {
          disconnect = this.onDisconnect.bind(this);
          provider.on("disconnect", disconnect);
        }

        // Switch to chain if provided
        let currentChainId = await this.getChainId();
        if (chainId && currentChainId !== chainId) {
          const chain = await this.switchChain!({ chainId }).catch((error) => {
            if (error.code === UserRejectedRequestError.code) throw error;
            return { id: currentChainId };
          });
          currentChainId = chain?.id ?? currentChainId;
        }

        return { accounts, chainId: currentChainId };
      } catch (error) {
        if (
          /(user closed modal|accounts received is empty|user denied account|request rejected)/i.test(
            (error as Error).message,
          )
        )
          throw new UserRejectedRequestError(error as Error);
        throw error;
      }
    },
    async disconnect() {
      const provider = await this.getProvider();

      if (accountsChanged) {
        provider.removeListener("accountsChanged", accountsChanged);
        accountsChanged = undefined;
      }
      if (chainChanged) {
        provider.removeListener("chainChanged", chainChanged);
        chainChanged = undefined;
      }
      if (disconnect) {
        provider.removeListener("disconnect", disconnect);
        disconnect = undefined;
      }

      provider.disconnect();
    },
    async getAccounts() {
      const provider = await this.getProvider();
      return (
        (await provider.request({
          method: "eth_accounts",
        })) as string[]
      ).map((x) => getAddress(x));
    },
    async getChainId() {
      const provider = await this.getProvider();
      const chainId = (await provider.request({
        method: "eth_chainId",
      })) as Hex;
      return Number(chainId);
    },
    async getProvider() {
      if (!walletProvider) {
        // Unwrapping import for Vite compatibility.
        // See: https://github.com/vitejs/vite/issues/9703
        const EIP1193Provider = await (async () =>
          (await import("@mobile-wallet-protocol/client")).EIP1193Provider)();

        walletProvider = new EIP1193Provider({
          metadata: {
            ...parameters.metadata,
            chainIds: config.chains.map((x) => x.id),
          },
          wallet: parameters.wallet,
        });
      }

      return walletProvider;
    },
    async isAuthorized() {
      try {
        const accounts = await this.getAccounts();
        return !!accounts.length;
      } catch {
        return false;
      }
    },
    async switchChain({ addEthereumChainParameter, chainId }) {
      const chain = config.chains.find((chain) => chain.id === chainId);
      if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());

      const provider = await this.getProvider();

      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: numberToHex(chain.id) }],
        });
        return chain;
      } catch (error) {
        // Indicates chain is not added to provider
        if ((error as ProviderRpcError).code === 4902) {
          try {
            let blockExplorerUrls: string[] | undefined;
            if (addEthereumChainParameter?.blockExplorerUrls)
              blockExplorerUrls = addEthereumChainParameter.blockExplorerUrls;
            else
              blockExplorerUrls = chain.blockExplorers?.default.url
                ? [chain.blockExplorers?.default.url]
                : [];

            let rpcUrls: readonly string[];
            if (addEthereumChainParameter?.rpcUrls?.length)
              rpcUrls = addEthereumChainParameter.rpcUrls;
            else rpcUrls = [chain.rpcUrls.default?.http[0] ?? ""];

            const addEthereumChain = {
              blockExplorerUrls,
              chainId: numberToHex(chainId),
              chainName: addEthereumChainParameter?.chainName ?? chain.name,
              iconUrls: addEthereumChainParameter?.iconUrls,
              nativeCurrency:
                addEthereumChainParameter?.nativeCurrency ??
                chain.nativeCurrency,
              rpcUrls,
            } satisfies AddEthereumChainParameter;

            await provider.request({
              method: "wallet_addEthereumChain",
              params: [addEthereumChain],
            });

            return chain;
          } catch (error) {
            throw new UserRejectedRequestError(error as Error);
          }
        }

        throw new SwitchChainError(error as Error);
      }
    },
    onAccountsChanged(accounts) {
      if (accounts.length === 0) this.onDisconnect();
      else
        config.emitter.emit("change", {
          accounts: accounts.map((x) => getAddress(x)),
        });
    },
    onChainChanged(chain) {
      const chainId = Number(chain);
      config.emitter.emit("change", { chainId });
    },
    async onDisconnect(_error) {
      config.emitter.emit("disconnect");

      const provider = await this.getProvider();
      if (accountsChanged) {
        provider.removeListener("accountsChanged", accountsChanged);
        accountsChanged = undefined;
      }
      if (chainChanged) {
        provider.removeListener("chainChanged", chainChanged);
        chainChanged = undefined;
      }
      if (disconnect) {
        provider.removeListener("disconnect", disconnect);
        disconnect = undefined;
      }
    },
  }));
}
