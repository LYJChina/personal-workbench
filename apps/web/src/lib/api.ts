import type { ProfileResponse, ProfileUpdate } from "@workbench/contracts";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

export const api = {
  getProfile: () => requestJson<ProfileResponse>("/profile"),
  updateProfile: (profile: ProfileUpdate) => requestJson<ProfileResponse>("/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  }),
  uploadProfilePhoto: async (photo: File) => {
    const form = new FormData();
    form.append("photo", photo);
    return requestJson<ProfileResponse>("/profile/photo", { method: "POST", body: form });
  }
};
