export function useDomainIcon() {
  const getDomainIcon = (urlOrDomain: string, size: number = 128) => {
    if (!urlOrDomain) return "";
    try {
      const domain = urlOrDomain.includes("://")
        ? new URL(urlOrDomain).hostname
        : urlOrDomain;
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
    } catch {
      return "";
    }
  };

  return { getDomainIcon };
}
