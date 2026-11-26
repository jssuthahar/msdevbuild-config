/**
 * MSDEVBUILD identity, shared by every site. Site-specific values (URL, title,
 * analytics, Firebase, nav) stay in each site's own config.
 */
export const BRAND = {
  org: 'MSDEVBUILD',
  orgFull: 'Multi-Stack Dev Build',
  /** Shown everywhere as: MSDEVBUILD · Multi-Stack Dev Build (owner's decision, 13 Nov 2026). */
  brandLine: 'MSDEVBUILD · Multi-Stack Dev Build',
  author: 'Suthahar Jegatheesan',
  authorTitle: 'Cloud, AI & Mobile Solutions Architect',
  authorLocation: 'Malaysia',
  profile: 'https://suthahar.msdevbuild.com',
  main: 'https://msdevbuild.com',
  blog: 'https://blog.msdevbuild.com',
  azure: 'https://azure.msdevbuild.com',
  support: { url: 'https://buymeacoffee.com/jssuthahar', label: 'Buy me a coffee' },
} as const;

export interface SocialLink {
  id: string;
  name: string;
  href: string;
  /** Short glyph shown inside the round badge. */
  icon: string;
  /** Brand colour of the network. */
  color: string;
  /** True for the MSDEVBUILD company page rather than Suthahar's own profile. */
  org?: boolean;
}

export const SOCIAL: readonly SocialLink[] = [
  { id: 'linkedin', name: 'LinkedIn', href: 'https://www.linkedin.com/in/jssuthahar', icon: 'in', color: '#0a66c2' },
  { id: 'youtube', name: 'YouTube', href: 'https://www.youtube.com/@MSDEVBUILD?sub_confirmation=1', icon: '▶', color: '#ff0000' },
  { id: 'x', name: 'X', href: 'https://x.com/jssuthahar', icon: '𝕏', color: '#000000' },
  { id: 'github', name: 'GitHub', href: 'https://github.com/jssuthahar', icon: 'GH', color: '#24292f' },
  { id: 'instagram', name: 'Instagram', href: 'https://www.instagram.com/msdevbuild/', icon: '◎', color: '#d62976' },
  { id: 'whatsapp', name: 'WhatsApp channel', href: 'https://whatsapp.com/channel/0029Va5j2rHEFeXcTlUhQB0J', icon: '✆', color: '#25d366' },
  { id: 'linkedin-org', name: 'MSDEVBUILD on LinkedIn', href: 'https://www.linkedin.com/company/31318247/', icon: 'in', color: '#0a66c2', org: true },
];
