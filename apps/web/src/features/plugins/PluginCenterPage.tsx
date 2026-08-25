import { Icon } from "../../app/Icon";
import { usePluginContributions } from "../../plugins/ContributionProvider";
import { PluginManager, type PluginManagerApi } from "./PluginManager";

interface PluginCenterPageProps { api?: PluginManagerApi; refreshContributions?: () => Promise<void>; }

export function PluginCenterPage({ api, refreshContributions }: PluginCenterPageProps) {
  const contributions = usePluginContributions();
  const refresh = refreshContributions ?? contributions.refresh;
  return <section className="settings-page plugin-center-page" aria-label="插件中心">
    <header className="page-heading"><div><span className="eyebrow">PLUGIN CENTER</span><h2>插件中心</h2><p>查看、启用或暂停工作台的功能模块。</p></div><div className="card-icon"><Icon name="grid" /></div></header>
    <PluginManager api={api} refreshContributions={refresh} kind="system" />
    <PluginManager api={api} refreshContributions={refresh} kind="third-party" />
  </section>;
}
