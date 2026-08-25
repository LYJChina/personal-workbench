import { Route, Routes } from "react-router-dom";
import { usePluginContributions } from "./ContributionProvider";

export function PluginRoutes() {
  const { routes } = usePluginContributions();
  return (
    <Routes>
      {routes.map(({ id, path, Component }) => <Route key={id} path={path} element={<Component />} />)}
    </Routes>
  );
}
