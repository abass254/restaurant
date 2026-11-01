import Script from "next/script";

const themeInit = `(function(){try{var t=localStorage.getItem('TransChap-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export function ThemeScript() {
  return <Script id="TransChap-theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInit }} />;
}
