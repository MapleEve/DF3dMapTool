import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyInitialLanguage } from "./i18n";
import "./index.css";

// 初始语言解析链（?lang= > 存档 > 浏览器语言 > 默认 zh）在渲染前完成应用。
void applyInitialLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
