import { InAppBrowser } from "@capacitor/in-app-browser";
import { App } from "@capacitor/app";
import { postRequestToWallet } from "./postRequestToWallet";
import {
  decodeResponseURLParams,
  encodeRequestURLParams,
} from "./utils/encoding";
import { RPCRequestMessage, RPCResponseMessage } from ":core/message";
import { Wallet } from ":core/wallet";

jest.mock("@capacitor/in-app-browser", () => ({
  InAppBrowser: {
    openInWebView: jest.fn(),
    close: jest.fn(),
    addListener: jest.fn(),
  },
}));

jest.mock("@capacitor/app", () => ({
  App: {
    addListener: jest.fn(),
  },
}));

jest.mock("./utils/encoding", () => ({
  ...jest.requireActual("./utils/encoding"),
  decodeResponseURLParams: jest.fn(),
}));

const mockAppCustomScheme = "myapp://";
const mockWalletScheme = "https://example.com";

describe("postRequestToWallet", () => {
  const mockRequest: RPCRequestMessage = {
    id: "1-2-3-4-5",
    sdkVersion: "1.0.0",
    content: {
      handshake: {
        method: "eth_requestAccounts",
        params: { appName: "test" },
      },
    },
    callbackUrl: "https://example.com",
    sender: "Sender",
    timestamp: new Date(),
  };

  const mockResponse: RPCResponseMessage = {
    id: "2-2-3-4-5",
    requestId: "1-2-3-4-5",
    content: {
      encrypted: {
        iv: new Uint8Array([1]),
        cipherText: new Uint8Array([2]),
      },
    },
    sender: "some-sender",
    timestamp: new Date(),
  };

  let requestUrl: URL;
  let mockAppListener: any;
  let mockBrowserListener: any;

  beforeEach(() => {
    requestUrl = new URL(mockWalletScheme);
    requestUrl.search = encodeRequestURLParams(mockRequest);

    // setup mock for app listener
    mockAppListener = { remove: jest.fn() };
    mockBrowserListener = { remove: jest.fn() };

    (App.addListener as jest.Mock).mockResolvedValue(mockAppListener);
    (InAppBrowser.addListener as jest.Mock).mockResolvedValue(
      mockBrowserListener,
    );

    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should successfully post request to a web-based wallet", async () => {
    const webWallet: Wallet = {
      type: "web",
      scheme: mockWalletScheme,
    } as Wallet;

    (InAppBrowser.openInWebView as jest.Mock).mockResolvedValue(undefined);
    (decodeResponseURLParams as jest.Mock).mockReturnValue(mockResponse);

    // create promise for testing async flow
    const resultPromise = postRequestToWallet(
      mockRequest,
      mockAppCustomScheme,
      webWallet,
    );

    // simulate successful app url open event
    const appUrlOpenCallback = (App.addListener as jest.Mock).mock.calls[0][1];
    appUrlOpenCallback({ url: `${mockAppCustomScheme}?response=data` });

    const result = await resultPromise;

    // verify inappbrowser was used correctly
    expect(InAppBrowser.openInWebView).toHaveBeenCalledWith({
      url: requestUrl.toString(),
      options: expect.any(Object),
    });

    // verify listeners were removed
    expect(mockAppListener.remove).toHaveBeenCalled();
    expect(mockBrowserListener.remove).toHaveBeenCalled();

    // verify browser was closed
    expect(InAppBrowser.close).toHaveBeenCalled();

    // verify result
    expect(result).toEqual(mockResponse);
  });

  it("should handle browser closed event", async () => {
    const webWallet: Wallet = {
      type: "web",
      scheme: mockWalletScheme,
    } as Wallet;

    (InAppBrowser.openInWebView as jest.Mock).mockResolvedValue(undefined);

    const resultPromise = postRequestToWallet(
      mockRequest,
      mockAppCustomScheme,
      webWallet,
    );

    // simulate browser closed event
    const browserClosedCallback = (InAppBrowser.addListener as jest.Mock).mock
      .calls[0][1];
    browserClosedCallback();

    await expect(resultPromise).rejects.toThrow("User rejected the request");
    expect(mockAppListener.remove).toHaveBeenCalled();
    expect(mockBrowserListener.remove).toHaveBeenCalled();
  });

  it("should throw an error if timeout occurs", async () => {
    const webWallet: Wallet = {
      type: "web",
      scheme: mockWalletScheme,
    } as Wallet;

    (InAppBrowser.openInWebView as jest.Mock).mockResolvedValue(undefined);

    const resultPromise = postRequestToWallet(
      mockRequest,
      mockAppCustomScheme,
      webWallet,
    );

    // fast-forward past timeout
    jest.advanceTimersByTime(5 * 60 * 1000 + 100);

    await expect(resultPromise).rejects.toThrow("User rejected the request");
    expect(mockAppListener.remove).toHaveBeenCalled();
    expect(mockBrowserListener.remove).toHaveBeenCalled();
    expect(InAppBrowser.close).toHaveBeenCalled();
  });

  it("should throw an error if InAppBrowser fails to open", async () => {
    const webWallet: Wallet = {
      type: "web",
      scheme: mockWalletScheme,
    } as Wallet;

    (InAppBrowser.openInWebView as jest.Mock).mockRejectedValue(
      new Error("Failed to open"),
    );

    await expect(
      postRequestToWallet(mockRequest, mockAppCustomScheme, webWallet),
    ).rejects.toThrow("User rejected the request");
  });

  // other tests remain the same
});
