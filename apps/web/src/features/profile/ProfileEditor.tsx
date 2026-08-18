import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import type { ProfileUpdate } from "@workbench/contracts";

interface ProfileEditorProps {
  initialProfile: ProfileUpdate;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (input: ProfileUpdate, photo: File | null) => void;
}

export function ProfileEditor({ initialProfile, isSaving, onCancel, onSave }: ProfileEditorProps) {
  const [profile, setProfile] = useState<ProfileUpdate>(initialProfile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(selected);
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!profile.name.trim()) nextErrors.name = "请输入姓名";
    if (!profile.employeeNumber.trim()) nextErrors.employeeNumber = "请输入员工编号";
    if (profile.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(profile.birthday)) nextErrors.birthday = "生日格式应为 YYYY-MM-DD";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) onSave(profile, photo);
  }

  function updateField(field: "name" | "birthday" | "employeeNumber", value: string) {
    setProfile((current) => ({ ...current, [field]: value }));
  }

  return (
    <form onSubmit={submit} noValidate>
      <label>
        姓名
        <input aria-invalid={Boolean(errors.name)} value={profile.name} onChange={(event) => updateField("name", event.target.value)} />
      </label>
      {errors.name && <p role="alert">{errors.name}</p>}
      <label>
        生日
        <input aria-invalid={Boolean(errors.birthday)} value={profile.birthday} onChange={(event) => updateField("birthday", event.target.value)} placeholder="YYYY-MM-DD" />
      </label>
      {errors.birthday && <p role="alert">{errors.birthday}</p>}
      <label>
        员工编号
        <input aria-invalid={Boolean(errors.employeeNumber)} value={profile.employeeNumber} onChange={(event) => updateField("employeeNumber", event.target.value)} />
      </label>
      {errors.employeeNumber && <p role="alert">{errors.employeeNumber}</p>}
      <fieldset>
        <legend>自定义信息</legend>
        {profile.customFields.map((field, index) => (
          <div key={index}>
            <label>
              标签
              <input value={field.label} onChange={(event) => setProfile((current) => ({ ...current, customFields: current.customFields.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) }))} />
            </label>
            <label>
              内容
              <input value={field.value} onChange={(event) => setProfile((current) => ({ ...current, customFields: current.customFields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) }))} />
            </label>
            <button type="button" onClick={() => setProfile((current) => ({ ...current, customFields: current.customFields.filter((_, itemIndex) => itemIndex !== index) }))}>删除</button>
          </div>
        ))}
        <button type="button" onClick={() => setProfile((current) => ({ ...current, customFields: [...current.customFields, { label: "", value: "" }] }))}>添加自定义信息</button>
      </fieldset>
      <label>
        头像
        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} />
      </label>
      {previewUrl && <img src={previewUrl} alt="新头像预览" />}
      <button type="submit" disabled={isSaving}>{isSaving ? "保存中" : "保存"}</button>
      <button type="button" onClick={onCancel} disabled={isSaving}>取消</button>
    </form>
  );
}
