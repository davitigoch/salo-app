import { getModuleLabel } from '../constants/moduleLabels';
import { supabase } from '../constants/supabase';

export const INDUSTRY_TEMPLATE_LABELS = {
  barber_shop: 'Barber Shop',
  beauty_salon: 'Beauty Salon',
  spa: 'Spa',
  dental_clinic: 'Dental Clinic',
  medical_practice: 'Medical Practice',
  wellness_clinic: 'Wellness Clinic',
  fitness_studio: 'Fitness Studio',
  coaching_consulting: 'Coaching / Consulting',
  other: 'Other',
};

export const INDUSTRY_CATEGORY_LABELS = {
  personal_grooming: 'Personal grooming',
  wellness_spa: 'Wellness & spa',
  healthcare: 'Healthcare',
  fitness: 'Fitness',
  professional_services: 'Professional services',
  general: 'General',
};

export function normalizeIndustryTemplateRow(row) {
  if (!row) {
    return null;
  }

  return {
    template_key: row.template_key,
    version: Number(row.version || 1),
    label: row.label,
    description: row.description || '',
    industry_category: row.industry_category || 'general',
    display_labels: row.display_labels || {},
    recommended_modules: Array.isArray(row.recommended_modules)
      ? row.recommended_modules
      : [],
    onboarding_shortcuts: row.onboarding_shortcuts || {},
    sample_services: Array.isArray(row.sample_services) ? row.sample_services : [],
    sort_order: Number(row.sort_order || 0),
  };
}

export function normalizeBusinessIndustryFields(business) {
  if (!business) {
    return null;
  }

  const metadata =
    business.template_metadata && typeof business.template_metadata === 'object'
      ? business.template_metadata
      : {};

  return {
    ...business,
    industry_template: business.industry_template || 'other',
    template_version: Number(business.template_version || 1),
    template_applied_at: business.template_applied_at || null,
    template_metadata: {
      industry_category: metadata.industry_category || 'general',
      display_labels: metadata.display_labels || {},
      recommended_modules: Array.isArray(metadata.recommended_modules)
        ? metadata.recommended_modules
        : [],
      onboarding_shortcuts: metadata.onboarding_shortcuts || {},
      sample_services: Array.isArray(metadata.sample_services)
        ? metadata.sample_services
        : [],
    },
  };
}

export async function fetchIndustryTemplates() {
  const { data, error } = await supabase.rpc('list_industry_templates');

  if (error) {
    return { data: [], error };
  }

  return {
    data: (Array.isArray(data) ? data : [])
      .map(normalizeIndustryTemplateRow)
      .filter(Boolean)
      .sort((first, second) => first.sort_order - second.sort_order),
    error: null,
  };
}

export async function applyIndustryTemplate(templateKey) {
  const normalizedKey = String(templateKey || '').trim();

  if (!normalizedKey) {
    return {
      data: null,
      error: { message: 'Industry template key is required.' },
    };
  }

  const { data, error } = await supabase.rpc('apply_industry_template', {
    p_template_key: normalizedKey,
  });

  if (error) {
    return { data: null, error };
  }

  return {
    data: normalizeBusinessIndustryFields(data),
    error: null,
  };
}

export function getIndustryTemplateLabel(templateKey, templates = []) {
  const key = String(templateKey || '').trim();

  if (!key) {
    return '';
  }

  const fromRegistry = (Array.isArray(templates) ? templates : []).find(
    (template) => template.template_key === key
  );

  if (fromRegistry?.label) {
    return fromRegistry.label;
  }

  return INDUSTRY_TEMPLATE_LABELS[key] || key.replace(/_/g, ' ');
}

export function getIndustryCategoryLabel(categoryKey, business = null) {
  const key = String(
    categoryKey ||
      business?.template_metadata?.industry_category ||
      business?.industry_category ||
      ''
  ).trim();

  if (!key) {
    return '';
  }

  return INDUSTRY_CATEGORY_LABELS[key] || key.replace(/_/g, ' ');
}

export function getRecommendedModuleLabels(moduleKeys) {
  const keys = Array.isArray(moduleKeys) ? moduleKeys : [];

  return keys
    .map((moduleKey) => getModuleLabel(moduleKey))
    .filter(Boolean);
}

export function getBusinessIndustryTemplateLabel(business, templates = []) {
  return getIndustryTemplateLabel(business?.industry_template, templates);
}

export function getBusinessRecommendedModuleLabels(business) {
  return getRecommendedModuleLabels(business?.template_metadata?.recommended_modules);
}
