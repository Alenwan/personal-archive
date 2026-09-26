alter table communications
  add column if not exists source text not null default 'Manual' check (
    source in (
      'Manual',
      'Gmail',
      'Outlook',
      'Twilio',
      'Asterisk / PBX',
      'Crater',
      'Carrier Portal',
      'Vendor Portal',
      'Other'
    )
  ),
  add column if not exists external_provider text not null default '',
  add column if not exists external_reference text not null default '',
  add column if not exists external_url text not null default '',
  add column if not exists supporting_document_id uuid references documents(document_id),
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create index if not exists communications_source_external_reference_idx
  on communications (source, external_reference)
  where external_reference <> '' and deleted_at is null;

create index if not exists communications_supporting_document_idx
  on communications (supporting_document_id)
  where supporting_document_id is not null and deleted_at is null;

comment on column communications.source is 'Manual or external integration source such as Gmail, Twilio, Asterisk/PBX, Crater, or carrier/vendor portals.';
comment on column communications.external_reference is 'External message, call, ticket, invoice, or provider record ID for future integrations.';
comment on column communications.source_metadata is 'Provider-specific metadata reserved for future integrations; not used for live automation yet.';
