# 工作台外观扩展指南

工作台 UI 采用“组件 + 语义变量 + 皮肤”的三层结构。业务组件不绑定某个颜色；皮肤只负责覆盖语义变量，因此增加新皮肤不需要改动主页、日报或设置表单。

## 用户可直接调整

打开“设置 → 外观”，可以实时切换：

- 界面皮肤：云境蓝、纸间白、青屿绿
- 浅色或深色主题
- 舒适或紧凑密度
- 柔和或轻微圆角
- 通透面板效果

这些外观偏好保存在本机浏览器的 `localStorage`，不会上传网络。DeepSeek 与邮件等业务设置仍保存在本地数据库。

## 开发新皮肤

1. 在 `apps/web/src/app/AppearanceProvider.tsx` 的 `WorkbenchSkin` 中添加皮肤标识，并将它加入 `isAppearance` 的白名单。
2. 在 `apps/web/src/styles/skins.css` 中分别添加浅色和深色的 `[data-theme][data-skin]` 变量块。
3. 在 `SettingsPage.tsx` 的皮肤注册列表中增加名称、说明和预览样式。
4. 只使用已有语义变量，例如 `--surface-background`、`--text-color`、`--primary-color`；不要在业务组件里写皮肤专属颜色。
5. 在 375px、768px 和桌面宽度检查浅色、深色、键盘焦点和文字对比度。

`skins.css` 是后续换肤的主要修改入口，`global.css` 负责所有皮肤共用的布局与组件规则。
