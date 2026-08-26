const themeBootstrap = `(function(){try{var key="sispl-theme";var saved=localStorage.getItem(key);var theme=(saved==="light"||saved==="dark")?saved:(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.setAttribute("data-theme",theme);document.documentElement.style.colorScheme=theme;}catch(error){document.documentElement.setAttribute("data-theme",matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />;
}
