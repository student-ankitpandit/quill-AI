import { QuillMark } from "@/components/QuillMark";
import { ArrowUpRight, Github, Linkedin } from "lucide-react";
import "./Footer.css";

const policyLinks = [
  { label: "Refund policy", href: "/#/refund-policy" },
  { label: "Return policy", href: "/#/return-policy" },
  { label: "Privacy policy", href: "/#/privacy-policy" },
  { label: "Terms & conditions", href: "/#/terms" },
];

export function SiteFooter() {
  return (
    <>
      <footer className="site-footer">
        <div className="site-footer-main">
          <div className="site-footer-brand">
            <a className="site-brand" href="/" aria-label="quill home">
              <span className="site-brand-mark"><QuillMark size={16} /></span>
              <span>quill</span>
            </a>
            <p>Coding is easy, Designing systems is what relevant now.</p>
          </div>

          <nav className="site-footer-links" aria-label="Policies">
            <h2>Policies</h2>
            {policyLinks.map((link) => <a key={link.href} href={link.href}>{link.label}</a>)}
          </nav>

          <nav className="site-footer-social" aria-label="Connect with quill">
            <h2>Connect</h2>
            <a href="https://x.com/ankitpanditdev" target="_blank" rel="noreferrer">
              <span className="x-social-mark" aria-hidden="true">𝕏</span> X <ArrowUpRight size={13} />
            </a>
            <a href="https://linkedin.com/in/panditankit" target="_blank" rel="noreferrer">
              <Linkedin size={14} /> LinkedIn <ArrowUpRight size={13} />
            </a>
            <a href="https://github.com/student-ankitpandit/Quill" target="_blank" rel="noreferrer">
              <Github size={14} /> GitHub <ArrowUpRight size={13} />
            </a>
          </nav>
        </div>
        <div className="site-footer-bottom">
          <span>© {new Date().getFullYear()} quill. All rights reserved.</span>
        </div>
      </footer>
      <div className="site-footer-watermark" aria-hidden="true">quill</div>
    </>
  );
}
