export interface LegalDocument {
  id: string;
  slug: string;
  version: number;
  title: string;
  content: string;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalAcceptance {
  id: string;
  document_id: string;
  customer_id: string | null;
  customer_phone: string | null;
  ip_address: string | null;
  user_agent: string | null;
  accepted_at: string;
}

export interface LegalAcceptanceWithDoc extends LegalAcceptance {
  document_title: string;
  document_slug: string;
  document_version: number;
}

export interface AcceptanceStats {
  document_id: string;
  slug: string;
  title: string;
  version: number;
  total_acceptances: number;
  unique_customers: number;
  latest_acceptance: string | null;
}

export interface CreateDocumentDto {
  title: string;
  content: string;
}

export interface UpdateDocumentDto {
  title?: string;
  content?: string;
}

export interface AcceptDocumentDto {
  customer_phone?: string;
}
