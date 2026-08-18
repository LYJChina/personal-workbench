export interface DailyQuote {
  text: string;
  author: string;
}

const quotes: readonly DailyQuote[] = [
  { text: "知者行之始，行者知之成。", author: "王阳明" },
  { text: "千里之行，始于足下。", author: "老子" },
  { text: "日日行，不怕千万里；常常做，不怕千万事。", author: "金缨" },
  { text: "不积跬步，无以至千里。", author: "荀子" },
  { text: "业精于勤，荒于嬉。", author: "韩愈" },
  { text: "凡事预则立，不预则废。", author: "《礼记》" },
  { text: "君子生非异也，善假于物也。", author: "荀子" },
  { text: "及时当勉励，岁月不待人。", author: "陶渊明" },
  { text: "纸上得来终觉浅，绝知此事要躬行。", author: "陆游" },
  { text: "锲而不舍，金石可镂。", author: "荀子" },
  { text: "博观而约取，厚积而薄发。", author: "苏轼" },
  { text: "长风破浪会有时，直挂云帆济沧海。", author: "李白" }
];

export function dailyQuote(date: Date): DailyQuote {
  const localDay = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return quotes[((localDay % quotes.length) + quotes.length) % quotes.length];
}
