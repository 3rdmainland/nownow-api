import { supabase } from '../lib/supabase.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import type {
  LegalDocument,
  LegalAcceptance,
  LegalAcceptanceWithDoc,
  AcceptanceStats,
  CreateDocumentDto,
  UpdateDocumentDto,
} from './legal.types.js';

export class LegalService {
  // ── Public ──────────────────────────────────────────────────────────

  /** Get the currently published version of a document by slug */
  async getPublished(slug: string): Promise<LegalDocument> {
    const { data, error } = await supabase
      .from('legal_documents')
      .select('*')
      .eq('slug', slug)
      .eq('is_published', true)
      .single();

    if (error || !data) throw new NotFoundError(`No published document found for "${slug}"`);
    return data as LegalDocument;
  }

  /** Record that a customer accepted the currently published version */
  async recordAcceptance(
    slug: string,
    customerId: string | null,
    customerPhone: string | null,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<LegalAcceptance> {
    const doc = await this.getPublished(slug);

    const { data, error } = await supabase
      .from('legal_acceptances')
      .insert({
        document_id: doc.id,
        customer_id: customerId,
        customer_phone: customerPhone,
        ip_address: ipAddress,
        user_agent: userAgent,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record acceptance: ${error.message}`);
    return data as LegalAcceptance;
  }

  // ── Admin ───────────────────────────────────────────────────────────

  /** List all documents (latest version per slug) */
  async listAll(): Promise<LegalDocument[]> {
    const { data, error } = await supabase
      .from('legal_documents')
      .select('*')
      .order('slug')
      .order('version', { ascending: false });

    if (error) throw new Error(`Failed to list documents: ${error.message}`);

    // Deduplicate — keep only the latest version per slug
    const seen = new Set<string>();
    const latest: LegalDocument[] = [];
    for (const doc of (data ?? []) as LegalDocument[]) {
      if (!seen.has(doc.slug)) {
        seen.add(doc.slug);
        latest.push(doc);
      }
    }
    return latest;
  }

  /** Get full version history for a slug */
  async getHistory(slug: string): Promise<LegalDocument[]> {
    const { data, error } = await supabase
      .from('legal_documents')
      .select('*')
      .eq('slug', slug)
      .order('version', { ascending: false });

    if (error) throw new Error(`Failed to get history: ${error.message}`);
    if (!data || data.length === 0) throw new NotFoundError(`No documents found for slug "${slug}"`);
    return data as LegalDocument[];
  }

  /** Create a new version of a document (auto-increments version per slug) */
  async createVersion(slug: string, dto: CreateDocumentDto, adminId: string | null): Promise<LegalDocument> {
    // Get current max version for this slug
    const { data: existing } = await supabase
      .from('legal_documents')
      .select('version')
      .eq('slug', slug)
      .order('version', { ascending: false })
      .limit(1);

    const nextVersion = existing && existing.length > 0 ? existing[0].version + 1 : 1;

    const row: Record<string, unknown> = {
      slug,
      version: nextVersion,
      title: dto.title,
      content: dto.content,
      is_published: false,
    };
    if (adminId) row.created_by = adminId;

    const { data, error } = await supabase
      .from('legal_documents')
      .insert(row)
      .select()
      .single();

    if (error) throw new Error(`Failed to create document: ${error.message}`);
    return data as LegalDocument;
  }

  /** Update an existing (unpublished) document version */
  async updateVersion(slug: string, version: number, dto: UpdateDocumentDto): Promise<LegalDocument> {
    // Prevent editing published documents — create a new version instead
    const { data: existing, error: findErr } = await supabase
      .from('legal_documents')
      .select('*')
      .eq('slug', slug)
      .eq('version', version)
      .single();

    if (findErr || !existing) throw new NotFoundError(`Document ${slug} v${version} not found`);
    if (existing.is_published) throw new ConflictError('Cannot edit a published document. Create a new version instead.');

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.content !== undefined) updates.content = dto.content;

    const { data, error } = await supabase
      .from('legal_documents')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update document: ${error.message}`);
    return data as LegalDocument;
  }

  /** Publish a specific version (unpublishes any other version of the same slug) */
  async publish(slug: string, version?: number): Promise<LegalDocument> {
    // If no version specified, publish the latest
    let targetVersion = version;
    if (!targetVersion) {
      const { data: latest } = await supabase
        .from('legal_documents')
        .select('version')
        .eq('slug', slug)
        .order('version', { ascending: false })
        .limit(1);

      if (!latest || latest.length === 0) throw new NotFoundError(`No documents found for slug "${slug}"`);
      targetVersion = latest[0].version;
    }

    // Unpublish all versions of this slug
    await supabase
      .from('legal_documents')
      .update({ is_published: false })
      .eq('slug', slug);

    // Publish the target version
    const { data, error } = await supabase
      .from('legal_documents')
      .update({ is_published: true, updated_at: new Date().toISOString() })
      .eq('slug', slug)
      .eq('version', targetVersion)
      .select()
      .single();

    if (error || !data) throw new NotFoundError(`Document ${slug} v${targetVersion} not found`);
    return data as LegalDocument;
  }

  /** Unpublish all versions of a slug */
  async unpublish(slug: string): Promise<void> {
    await supabase
      .from('legal_documents')
      .update({ is_published: false })
      .eq('slug', slug);
  }

  /** List acceptances with optional filtering */
  async getAcceptances(params: {
    slug?: string;
    page?: number;
    limit?: number;
  }): Promise<{ acceptances: LegalAcceptanceWithDoc[]; total: number }> {
    const page = params.page ?? 1;
    const limit = Math.min(params.limit ?? 50, 100);
    const offset = (page - 1) * limit;

    // Build query with join
    let query = supabase
      .from('legal_acceptances')
      .select(`
        *,
        legal_documents!inner (title, slug, version)
      `, { count: 'exact' });

    if (params.slug) {
      query = query.eq('legal_documents.slug', params.slug);
    }

    const { data, error, count } = await query
      .order('accepted_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(`Failed to get acceptances: ${error.message}`);

    const acceptances: LegalAcceptanceWithDoc[] = ((data ?? []) as any[]).map(row => ({
      id: row.id,
      document_id: row.document_id,
      customer_id: row.customer_id,
      customer_phone: row.customer_phone,
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      accepted_at: row.accepted_at,
      document_title: row.legal_documents?.title ?? '',
      document_slug: row.legal_documents?.slug ?? '',
      document_version: row.legal_documents?.version ?? 0,
    }));

    return { acceptances, total: count ?? 0 };
  }

  /** Get acceptance statistics per published document */
  async getAcceptanceStats(): Promise<AcceptanceStats[]> {
    // Get all published documents
    const { data: docs, error: docsErr } = await supabase
      .from('legal_documents')
      .select('id, slug, title, version')
      .eq('is_published', true);

    if (docsErr) throw new Error(`Failed to get docs: ${docsErr.message}`);
    if (!docs || docs.length === 0) return [];

    const stats: AcceptanceStats[] = [];

    for (const doc of docs) {
      const { count, error: countErr } = await supabase
        .from('legal_acceptances')
        .select('*', { count: 'exact', head: true })
        .eq('document_id', doc.id);

      if (countErr) continue;

      // Get unique customer count
      const { data: uniqueData } = await supabase
        .from('legal_acceptances')
        .select('customer_id')
        .eq('document_id', doc.id)
        .not('customer_id', 'is', null);

      const uniqueCustomers = new Set((uniqueData ?? []).map(r => r.customer_id)).size;

      // Get latest acceptance
      const { data: latestData } = await supabase
        .from('legal_acceptances')
        .select('accepted_at')
        .eq('document_id', doc.id)
        .order('accepted_at', { ascending: false })
        .limit(1);

      stats.push({
        document_id: doc.id,
        slug: doc.slug,
        title: doc.title,
        version: doc.version,
        total_acceptances: count ?? 0,
        unique_customers: uniqueCustomers,
        latest_acceptance: latestData?.[0]?.accepted_at ?? null,
      });
    }

    return stats;
  }
}

export const legalService = new LegalService();
