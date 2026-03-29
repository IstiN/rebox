import type { Config } from './config.js';
import { ReboxHttpError } from './errors.js';

export interface DefuddleRunOptions {
  markdown: boolean;
  separateMarkdown: boolean;
  language?: string;
  contentSelector?: string;
  debug: boolean;
}

export interface DefuddleArticle {
  contentHtml?: string;
  contentMarkdown?: string;
  description?: string;
  author?: string;
  site?: string;
  domain?: string;
  language?: string;
  published?: string;
  wordCount?: number;
  extractorType?: string;
  schemaOrgData?: Record<string, unknown>;
}

export async function runDefuddle(
  _cfg: Config,
  pageUrl: string,
  html: string,
  opts: DefuddleRunOptions,
): Promise<{ article: DefuddleArticle; defuddleMs: number }> {
  const { Defuddle } = await import('defuddle/node');
  const t0 = Date.now();
  try {
    const result = await Defuddle(html, pageUrl, {
      markdown: opts.markdown,
      separateMarkdown: opts.separateMarkdown,
      language: opts.language,
      contentSelector: opts.contentSelector,
      debug: opts.debug,
    });
    const defuddleMs = Date.now() - t0;
    const article: DefuddleArticle = {
      contentHtml: result.content,
      contentMarkdown: result.contentMarkdown,
      description: result.description,
      author: result.author,
      site: result.site,
      domain: result.domain,
      language: result.language,
      published: result.published,
      wordCount: result.wordCount,
      extractorType: result.extractorType,
      schemaOrgData: result.schemaOrgData as Record<string, unknown> | undefined,
    };
    return { article, defuddleMs };
  } catch (e) {
    throw new ReboxHttpError(
      'EXTRACTION_FAILED',
      e instanceof Error ? e.message : 'Defuddle failed',
      502,
    );
  }
}
