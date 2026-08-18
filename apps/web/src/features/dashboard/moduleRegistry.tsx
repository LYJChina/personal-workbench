import { useEffect, useState } from "react";
import type { ModuleId, ProfileResponse, ProfileUpdate } from "@workbench/contracts";
import { ProfileCard } from "../profile/ProfileCard";
import { api } from "../../lib/api";

export interface ModuleDefinition {
  id: ModuleId;
  title: string;
  minW: number;
  minH: number;
  render: () => React.ReactNode;
}

const emptyProfile: ProfileResponse = {
  name: "",
  birthday: "",
  employeeNumber: "",
  customFields: [],
  photoFilename: null
};

function ProfileModule() {
  const [profile, setProfile] = useState<ProfileResponse>(emptyProfile);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getProfile().then(setProfile).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "个人信息加载失败"));
  }, []);

  async function saveProfile(input: ProfileUpdate) {
    setProfile(await api.updateProfile(input));
  }

  async function uploadPhoto(photo: File) {
    const saved = await api.uploadProfilePhoto(photo);
    setProfile(saved);
    return saved;
  }

  return <>{error && <p role="alert">{error}</p>}<ProfileCard initialProfile={profile} onSave={saveProfile} onUploadPhoto={uploadPhoto} /></>;
}

export const moduleRegistry: Record<ModuleId, ModuleDefinition> = {
  profile: {
    id: "profile",
    title: "个人信息",
    minW: 6,
    minH: 4,
    render: () => <ProfileModule />
  }
};
