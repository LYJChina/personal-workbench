import { useEffect, useState } from "react";
import type { ProfileResponse, ProfileUpdate } from "@workbench/contracts";
import { ProfileEditor } from "./ProfileEditor";

interface ProfileCardProps {
  initialProfile: ProfileResponse;
  onSave: (input: ProfileUpdate) => Promise<void>;
  onUploadPhoto?: (photo: File) => Promise<ProfileResponse>;
}

export function ProfileCard({ initialProfile, onSave, onUploadPhoto }: ProfileCardProps) {
  const [profile, setProfile] = useState(initialProfile);
  const [editing, setEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setProfile(initialProfile);
  }, [editing, initialProfile]);

  async function save(input: ProfileUpdate, photo: File | null) {
    setIsSaving(true);
    setFeedback(null);
    try {
      await onSave(input);
      let saved: ProfileResponse = { ...profile, ...input };
      if (photo && onUploadPhoto) saved = await onUploadPhoto(photo);
      setProfile(saved);
      setEditing(false);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  }

  if (editing) {
    return (
      <section aria-label="个人信息编辑">
        <h2>编辑个人信息</h2>
        {feedback && <p role="alert">{feedback}</p>}
        <ProfileEditor initialProfile={profile} isSaving={isSaving} onCancel={() => setEditing(false)} onSave={save} />
      </section>
    );
  }

  return (
    <section aria-label="个人信息">
      <h2>个人信息</h2>
      {profile.photoFilename && <img src={`/api/profile/photo/${profile.photoFilename}`} alt={`${profile.name}的头像`} />}
      <p>姓名：{profile.name || "未填写"}</p>
      <p>生日：{profile.birthday || "未填写"}</p>
      <p>员工编号：{profile.employeeNumber || "未填写"}</p>
      {profile.customFields.map((field) => <p key={`${field.label}-${field.value}`}>{field.label}：{field.value}</p>)}
      <button type="button" onClick={() => { setFeedback(null); setEditing(true); }}>编辑个人信息</button>
    </section>
  );
}
