function toBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(value: string) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomBytes(len: number) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return bytes;
}

function isSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && !!navigator.credentials;
}

export async function enrollBiometric(credentialKey: string, userLabel: string) {
  if (!isSupported()) {
    return { ok: false, error: "Biometric auth is not supported on this browser/device." };
  }

  try {
    const userId = randomBytes(16);
    const challenge = randomBytes(32);
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "MirrorMe" },
        user: {
          id: userId,
          name: userLabel || "user@mirrorme.app",
          displayName: userLabel || "MirrorMe User"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
      }
    })) as PublicKeyCredential | null;

    if (!credential?.rawId) {
      return { ok: false, error: "Biometric setup failed. Please try again." };
    }

    localStorage.setItem(credentialKey, toBase64(new Uint8Array(credential.rawId)));
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Biometric setup failed.";
    return { ok: false, error: message };
  }
}

export async function verifyBiometric(credentialKey: string) {
  if (!isSupported()) {
    return { ok: false, error: "Biometric auth is not supported on this browser/device." };
  }

  const encoded = localStorage.getItem(credentialKey);
  if (!encoded) {
    return { ok: false, error: "Biometric is not set up yet." };
  }

  try {
    const challenge = randomBytes(32);
    const id = fromBase64(encoded);
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: "public-key", id }],
        userVerification: "required",
        timeout: 60000
      }
    })) as PublicKeyCredential | null;

    if (!assertion) {
      return { ok: false, error: "Biometric verification failed." };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Biometric verification failed.";
    return { ok: false, error: message };
  }
}
