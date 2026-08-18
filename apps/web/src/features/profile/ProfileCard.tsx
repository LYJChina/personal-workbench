import { useEffect, useState } from "react";
import type { ProfileResponse, ProfileUpdate } from "@workbench/contracts";
import { ProfileEditor } from "./ProfileEditor";
import { Icon } from "../../app/Icon";

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
      <section aria-label="个人信息编辑" className="profile-card profile-editor-card">
        <div className="card-heading"><div className="card-icon"><Icon name="user" /></div><div><span className="eyebrow">PROFILE</span><h2>编辑个人信息</h2></div></div>
        {feedback && <p role="alert">{feedback}</p>}
        <ProfileEditor initialProfile={profile} isSaving={isSaving} onCancel={() => setEditing(false)} onSave={save} />
      </section>
    );
  }

  return (
    <section aria-label="个人信息" className="profile-card">
      <div className="profile-hero">
        <div className="profile-avatar">
          {profile.photoFilename ? <img src={`/api/profile/photo/${profile.photoFilename}`} alt={`${profile.name}的头像`} /> : <span>{profile.name.trim().slice(0, 1).toUpperCase() || "LYJ"}</span>}
        </div>
        <div className="profile-identity"><span className="eyebrow">MY PROFILE</span><h2>{profile.name || "你好，欢迎回来"}</h2><p>{profile.employeeNumber ? `员工编号 ${profile.employeeNumber}` : "完善个人信息，让工作台真正属于你"}</p></div>
        <button aria-label="编辑个人信息" className="button-secondary compact" type="button" onClick={() => { setFeedback(null); setEditing(true); }}><Icon name="edit" size={16} />编辑资料</button>
      </div>
      <span className="sr-only">姓名：{profile.name || "未填写"}</span>
      <span className="sr-only">员工编号：{profile.employeeNumber || "未填写"}</span>
      <div className="profile-details">
        <div><span>生日</span><strong>{profile.birthday || "未填写"}</strong></div>
        <div><span>员工编号</span><strong>{profile.employeeNumber || "未填写"}</strong></div>
        {profile.customFields.map((field) => <div key={`${field.label}-${field.value}`}><span>{field.label}</span><strong>{field.value || "未填写"}</strong></div>)}
      </div>
    </section>
  );
}
