import type { AiPolishKind } from "@workbench/contracts";
import type { IconName } from "../../app/Icon";

export interface PolishPreset {
  kind: AiPolishKind;
  title: string;
  description: string;
  icon: IconName;
  primaryLabel: string;
  primaryHint: string;
  primaryPlaceholder: string;
  secondaryLabel: string;
  secondaryHint: string;
  secondaryPlaceholder: string;
  defaultSecondary: string;
  actionLabel: string;
  systemPrompt: string;
}

export const polishPresets: PolishPreset[] = [
  {
    kind: "daily_report", title: "日报填写", description: "整理今日完成与问题风险", icon: "file",
    primaryLabel: "今日完成", primaryHint: "写下事项或关键词", primaryPlaceholder: "例如：完成项目周报页面；修复登录超时问题…",
    secondaryLabel: "问题与风险", secondaryHint: "没有可留空", secondaryPlaceholder: "例如：接口文档仍待确认，可能影响联调进度…", defaultSecondary: "", actionLabel: "生成日报",
    systemPrompt: "你是一名专业、简洁的中文工作日报助手。忠实整理用户事实，不得补充未提供的信息。输入存在相应内容时，仅使用“今日完成”和“问题与风险”作为章节标题；输入为空时省略该章节。表达清晰、具体，避免空话和夸张。"
  },
  {
    kind: "leadership", title: "给领导的话", description: "把信息整理得得体、清楚", icon: "mail",
    primaryLabel: "沟通素材", primaryHint: "写下事情原委和关键信息", primaryPlaceholder: "例如：项目已完成第一阶段，下一步需要确认预算…",
    secondaryLabel: "希望领导关注", secondaryHint: "可填写需要决策或支持的事项", secondaryPlaceholder: "例如：希望周三前确认方案；需要协调测试资源…", defaultSecondary: "", actionLabel: "整理沟通文案",
    systemPrompt: "你是一名稳妥的职场沟通助手。将素材整理为可直接发给领导的中文消息：结论先行，语气尊重、自然、简洁；清楚交代进展、影响以及需要的决策或支持；不夸大、不甩锅、不虚构，不使用过度客套的套话。只输出消息正文。"
  },
  {
    kind: "translation", title: "翻译", description: "保留语义和专业表达", icon: "copy",
    primaryLabel: "待翻译原文", primaryHint: "粘贴需要翻译的内容", primaryPlaceholder: "在这里输入或粘贴原文…",
    secondaryLabel: "目标语言及要求", secondaryHint: "可修改语言或语气", secondaryPlaceholder: "例如：英语，正式商务语气", defaultSecondary: "英语，正式自然的商务语气", actionLabel: "开始翻译",
    systemPrompt: "你是一名专业翻译。将用户原文准确翻译成指定目标语言，完整保留事实、数字、专有名词、段落结构和语气；不擅自解释、删减或补充内容。目标语言未明确时翻译为简体中文。只输出译文。"
  },
  {
    kind: "general", title: "普通润色", description: "修正表达，保持原意", icon: "edit",
    primaryLabel: "待润色原文", primaryHint: "粘贴需要优化的文字", primaryPlaceholder: "在这里输入或粘贴原文…",
    secondaryLabel: "风格要求", secondaryHint: "可留空", secondaryPlaceholder: "例如：更简洁、正式，但不要生硬", defaultSecondary: "", actionLabel: "开始润色",
    systemPrompt: "你是一名专业中文编辑。保持原意和事实不变，修正语病、歧义、重复和不自然表达，使文字清晰、流畅、简洁；遵循用户给出的风格要求，不添加原文没有的结论。只输出润色后的正文。"
  }
];

export function presetFor(kind: AiPolishKind): PolishPreset {
  return polishPresets.find((preset) => preset.kind === kind) ?? polishPresets[0];
}
