// Native app identity and deployment checks. All values here are public config.
module.exports = ({ config }) => {
  const variant = process.env.SUBWISE_APP_VARIANT || "development";
  if (!["development", "preview", "production"].includes(variant)) {
    throw new Error(
      "SUBWISE_APP_VARIANT must be development, preview or production.",
    );
  }
  const api = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (variant !== "development" && !api) {
    throw new Error(
      "Set EXPO_PUBLIC_API_URL to the reachable HTTPS backend before building a preview or store app.",
    );
  }
  if (api) {
    let url;
    try {
      url = new URL(api);
    } catch {
      throw new Error("EXPO_PUBLIC_API_URL must be a valid HTTPS origin.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error(
        "EXPO_PUBLIC_API_URL must be an HTTPS origin without credentials, a path, query or fragment.",
      );
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.includes("your_backend") ||
      hostname.endsWith(".example") ||
      hostname.endsWith(".invalid") ||
      hostname.endsWith(".test")
    ) {
      throw new Error(
        "Use a backend reachable by the phone, not localhost or a placeholder.",
      );
    }
  }
  const suffix =
    variant === "production" ? "" : variant === "preview" ? ".preview" : ".dev";
  const label =
    variant === "production" ? "" : variant === "preview" ? " Preview" : " Dev";
  const projectId = process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId;
  if (
    projectId &&
    !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(projectId)
  ) {
    throw new Error(
      "EAS_PROJECT_ID must be the UUID assigned to your Expo project.",
    );
  }
  return {
    ...config,
    name: "Subwise" + label,
    scheme: variant === "production" ? "subwise" : "subwise-" + variant,
    ios: {
      ...config.ios,
      bundleIdentifier: config.ios.bundleIdentifier + suffix,
      infoPlist: {
        ...config.ios.infoPlist,
        NSAppTransportSecurity: {
          ...config.ios.infoPlist?.NSAppTransportSecurity,
          NSAllowsArbitraryLoads: false,
          NSAllowsLocalNetworking: variant === "development",
        },
        ...(variant === "development"
          ? {
              NSLocalNetworkUsageDescription:
                "Connect to the development server on your computer.",
            }
          : {}),
      },
    },
    android: { ...config.android, package: config.android.package + suffix },
    extra: {
      ...config.extra,
      appVariant: variant,
      ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}),
    },
  };
};
