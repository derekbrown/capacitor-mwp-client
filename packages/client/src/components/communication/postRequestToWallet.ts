import { InAppBrowser } from "@capacitor/in-app-browser";
import { App } from "@capacitor/app";
import { decodeResponseURLParams } from "./utils/encoding";
import { encodeRequestURLParams } from "./utils/encoding";
import { standardErrors } from ":core/error";
import { RPCRequestMessage, RPCResponseMessage } from ":core/message";
import { Wallet } from ":core/wallet";

/**
 * Posts a request to a wallet and waits for the response.
 *
 * @param request - The request to send.
 * @param wallet - The wallet to send the request to.
 * @returns A promise that resolves to the response.
 */
export async function postRequestToWallet(
  request: RPCRequestMessage,
  appCustomScheme: string,
  wallet: Wallet,
): Promise<RPCResponseMessage> {
  const { type, scheme } = wallet;
  if (type === "web") {
    return new Promise((resolve, reject) => {
      let listener: any = null;
      let timeoutId: any = null;
      let browserClosedListener: any = null;

      // setup app url open listener
      const setupListener = async () => {
        listener = await App.addListener("appUrlOpen", async (event) => {
          if (event.url.startsWith(appCustomScheme)) {
            // clean up
            if (listener) listener.remove();
            if (browserClosedListener) browserClosedListener.remove();
            if (timeoutId) clearTimeout(timeoutId);
            await InAppBrowser.close();

            // parse the response
            try {
              const { searchParams } = new URL(event.url);
              const response = decodeResponseURLParams(searchParams);
              resolve(response);
            } catch (error) {
              reject(standardErrors.provider.userRejectedRequest());
            }
          }
        });

        // listen for browser closed event
        browserClosedListener = await InAppBrowser.addListener(
          "browserClosed",
          async () => {
            if (listener) listener.remove();
            if (browserClosedListener) browserClosedListener.remove();
            if (timeoutId) clearTimeout(timeoutId);
            reject(standardErrors.provider.userRejectedRequest());
          },
        );
      };

      // setup timeout to handle user abandoning the flow
      timeoutId = setTimeout(
        async () => {
          if (listener) listener.remove();
          if (browserClosedListener) browserClosedListener.remove();
          await InAppBrowser.close();
          reject(standardErrors.provider.userRejectedRequest());
        },
        5 * 60 * 1000,
      ); // 5 minute timeout

      // generate request URL
      const requestUrl = new URL(scheme);
      requestUrl.search = encodeRequestURLParams(request);

      // launch the flow
      const start = async () => {
        try {
          await setupListener();
          await InAppBrowser.openInWebView({
            url: requestUrl.toString(),
            options: {
              showToolbar: true,
              toolbarPosition: "top",
              showNavigationButtons: true,
              closeButtonText: "Close",
              showURL: true,
            },
          });
        } catch (error) {
          if (listener) listener.remove();
          if (browserClosedListener) browserClosedListener.remove();
          if (timeoutId) clearTimeout(timeoutId);
          reject(standardErrors.provider.userRejectedRequest());
        }
      };

      start();
    });
  }

  if (type === "native") {
    throw new Error("Native wallet not supported yet");
  }

  throw new Error("Unsupported wallet type");
}
