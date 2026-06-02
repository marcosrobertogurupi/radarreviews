export type PartnerStatus = 'active' | 'inactive' | 'suspended';

export type PartnerType = 'agency' | 'consultant' | 'sales_rep';

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';

export interface Partner {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone?: string | null;
  company_name?: string | null;
  partner_type: PartnerType;
  commission_setup_rate: number;
  commission_recurring_rate: number;
  status: PartnerStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Commission {
  id: string;
  partner_id: string;
  tenant_id: string;
  reference_month: string;
  plan_name: string;
  plan_value: number;
  is_setup: boolean;
  commission_rate: number;
  commission_value: number; // readonly (generated)
  status: CommissionStatus;
  approved_at?: string | null;
  paid_at?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerDashboardSummary {
  partner_id: string;
  user_id: string;
  partner_name: string;
  partner_type: PartnerType;
  commission_setup_rate: number;
  commission_recurring_rate: number;
  total_clients: number;
  active_clients: number;
  trial_clients: number;
  current_month_mrr: number;
  pending_commission: number;
  approved_commission: number;
  total_paid_commission: number;
}

export interface PartnerTenant {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  status: string;
  plan: string;
  is_active: boolean;
  created_at: string;
  partner_id: string;
}

export interface RegisterTenantPayload {
  partner_id: string;
  business_name: string;
  email: string;
  phone?: string;
  plan_slug?: string;
}

export interface CommissionFilters {
  status?: CommissionStatus;
  reference_month?: string;
  tenant_id?: string;
}
