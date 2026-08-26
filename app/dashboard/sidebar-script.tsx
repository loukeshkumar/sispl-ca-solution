/**
 * Applies the saved sidebar width before first paint.
 *
 * Without this the sidebar would render expanded and then snap to the rail on
 * hydration, shifting the whole workspace sideways in front of the reader. Runs
 * from `<head>` for the same reason the theme bootstrap does.
 *
 * With no saved preference the choice comes from the viewport: below 1280px the
 * rail is the sensible default, above it there is room for labels.
 */
const sidebarBootstrap = `(function(){try{var saved=localStorage.getItem("sispl-sidebar");var mode=(saved==="rail"||saved==="full")?saved:(window.innerWidth<1280?"rail":"full");document.documentElement.setAttribute("data-sidebar",mode);}catch(error){document.documentElement.setAttribute("data-sidebar","full");}})();`;

export function SidebarScript() {
  return <script dangerouslySetInnerHTML={{ __html: sidebarBootstrap }} />;
}
