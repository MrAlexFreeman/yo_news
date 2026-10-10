import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

import { VideoEmbed } from "@/app/admin/articles/components/video-embed-node";
import {
  ArticleFigure,
  ArticleFigcaption,
} from "@/app/admin/articles/components/article-figure-node";
import { Cite } from "@/app/admin/articles/components/article-quote";
import { EntityCardLink } from "@/app/admin/articles/components/entity-card-node";
import { ReadAlsoBlockNode } from "@/app/admin/articles/components/read-also-node";

/**
 * How a link looks in the editor.
 *
 * The same amber the sanitiser applies to links on the public page, so the editor
 * and the article agree and an editor can trust what they see here. `.article-body`
 * already styles anchors, but stating it on the mark as well means a link is still
 * visibly a link if the prose cascade is ever changed.
 */
export const LINK_CLASS =
  "text-amber-600 hover:text-amber-700 underline font-medium";

/**
 * The editor's schema, in one place.
 *
 * Lives apart from the component so the checks can build a real editor from the
 * same list the UI uses. A test that assembled its own extensions would go on
 * passing after someone changed the component, which is precisely the failure this
 * file exists to prevent.
 *
 * The set is chosen to cover everything the toolbar can emit and everything the
 * sanitiser permits the toolbar to emit. Anything TipTap's schema does not know is
 * deleted from the body the first time that article is saved, so the additions here
 * — video, table, underline, alignment — are data-preservation decisions, not
 * features for their own sake.
 */
export function editorExtensions() {
  return [
    // StarterKit v3 ships Link and Underline. Left enabled they would register a
    // second copy of each extension under the same name, and the editor would pick
    // one of the pair at random; both are configured explicitly instead.
    StarterKit.configure({
      link: false,
      underline: false,
      // h2 and h3 only: the stylesheet sizes those, and an h1 inside a body would
      // compete with the article title.
      heading: { levels: [2, 3] },
      codeBlock: { HTMLAttributes: { class: "text-sm" } },
    }),
    Underline,
    Link.configure({
      // An editor that navigates away on click cannot be edited around, and a
      // body full of links would make ordinary clicking useless.
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      // Clicking a link puts the caret in it instead of following it.
      enableClickSelection: true,
      HTMLAttributes: {
        class: LINK_CLASS,
        // TipTap's default rel is "noopener noreferrer nofollow". The last part is
        // wrong for this publication: the link dialog exists to cross-link articles,
        // and nofollow on an internal link tells search engines to stop there. rel is
        // set per link instead — noopener only where the link opens a new tab.
        rel: null,
      },
      // inclusive: false, so typing at the edge of a link writes plain text instead
      // of continuing the link.
      //
      // This is the difference between a link and a trap. With the default the mark
      // swallows everything typed after it: finish a sentence, carry on, and the
      // next few words turn orange and underlined with no sign of why, then ship as
      // part of the link. Measured here — text typed at the trailing edge of
      // `<a>релиз</a>` came out as `<a>рели后续з</a>`.
      //
      // The usual reason to want an inclusive mark is to keep writing a long link
      // text by hand. In this editor the label comes from the link dialog and the URL
      // from an article search, so that case does not arise, and the mistake costs far
      // more than the convenience is worth. Extending an existing link is done by
      // selecting the text and pressing the button, which is what «Ссылка» is for.
      //
      // On `extend` rather than `configure`: `inclusive` is part of the mark spec, not
      // an extension option.
    }).extend({ inclusive: false }),
    Placeholder.configure({ placeholder: "Начните писать текст материала…" }),
    // inline: false keeps an image a block of its own; allowBase64: false because
    // the body is stored HTML and a data URI would bloat the article row.
    Image.configure({ inline: false, allowBase64: false }),
    // The picture-with-caption block, and its caption. Registered after Image so the
    // image node exists when the figure's content expression is resolved.
    ArticleFigcaption,
    ArticleFigure,
    // The attribution mark, so `<cite>` survives a round trip instead of being
    // flattened into a paragraph.
    Cite,
    TextAlign.configure({
      types: ["heading", "paragraph", "image"],
      alignments: ["left", "center", "right", "justify"],
    }),
    // TableKit, not Table: v3 splits a table into four nodes and the Table node
    // alone references row/cell/header by name, so adding it by itself throws
    // while the schema is being built.
    TableKit.configure({ table: { resizable: false } }),
    VideoEmbed,
    /*
      The card reference, registered after Link so its mark wins where the two overlap —
      an entity href is a site-relative path and Link's parser would otherwise claim every
      card reference as a plain link, which is the version that renders as an ordinary
      amber link with no dashed underline and no popover.
    */
    EntityCardLink,
    /*
      The "read also" plate. Registered last so its `figure.read-also` parser is asked
      before anything else claims the figure — `ArticleFigure` matches any `figure`, and
      without this ordering a plate opened as an empty figure with the anchor lost.
    */
    ReadAlsoBlockNode,
  ];
}