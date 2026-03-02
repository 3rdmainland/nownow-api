drop extension if exists "pg_net";

create type "public"."event_status" as enum ('ACTIVE', 'CANCELED');

create type "public"."menu_item_type" as enum ('FOOD', 'RETAIL');

create type "public"."order_status" as enum ('PENDING', 'PREPARING', 'READY', 'COLLECTED', 'CANCELLED');

create type "public"."order_type" as enum ('CART', 'ORDER', 'CANCELLED');


  create table "public"."categories" (
    "id" uuid not null default gen_random_uuid(),
    "name" character varying(100) not null,
    "description" text,
    "type" character varying(50) not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."default_menu_items" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "category_id" uuid not null,
    "sku" character varying(50),
    "name" character varying(200) not null,
    "slug" character varying(220) not null,
    "description" text,
    "short_description" character varying(200),
    "image_url" text,
    "images" jsonb default '[]'::jsonb,
    "type" character varying(20) not null,
    "base_price" numeric(10,2) not null,
    "cost_price" numeric(10,2),
    "pricing_strategy" character varying(20) default 'FIXED'::character varying,
    "prep_time" integer,
    "cooking_instructions" text,
    "track_inventory" boolean default false,
    "stock_quantity" integer,
    "low_stock_threshold" integer,
    "availability_status" character varying(20) default 'AVAILABLE'::character varying,
    "tag_ids" uuid[] default '{}'::uuid[],
    "modifier_group_ids" uuid[] default '{}'::uuid[],
    "display_order" integer default 0,
    "is_featured" boolean default false,
    "is_popular" boolean default false,
    "nutritional_info" jsonb,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."discounts" (
    "id" uuid not null default gen_random_uuid(),
    "event_id" uuid not null,
    "vendor_id" uuid,
    "scope" text not null,
    "target_item_ids" uuid[],
    "type" text not null,
    "value" numeric(10,2) not null,
    "is_active" boolean not null default true,
    "created_by" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );



  create table "public"."event_day_hours" (
    "id" uuid not null default gen_random_uuid(),
    "event_id" uuid not null,
    "date" date not null,
    "open_time" text not null,
    "close_time" text not null,
    "is_closed" boolean not null default false
      );



  create table "public"."event_menu_configurations" (
    "id" uuid not null default gen_random_uuid(),
    "event_id" uuid not null,
    "vendor_id" uuid not null,
    "template_id" uuid,
    "global_price_adjustment" jsonb,
    "is_accepting_orders" boolean default true,
    "max_concurrent_orders" integer,
    "current_active_orders" integer default 0,
    "order_cooldown_minutes" integer,
    "operating_schedule" jsonb default '[]'::jsonb,
    "category_configurations" jsonb default '[]'::jsonb,
    "status" character varying(20) default 'DRAFT'::character varying,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "max_orders_per_customer_event" integer,
    "prep_time_buffer_minutes" integer,
    "estimated_wait_minutes" integer,
    "booth_info" text,
    "vendor_notice" text,
    "event_open_time" text,
    "event_close_time" text
      );



  create table "public"."event_menu_items" (
    "id" uuid not null default gen_random_uuid(),
    "event_id" uuid not null,
    "vendor_id" uuid not null,
    "default_menu_item_id" uuid not null,
    "price_override" numeric(10,2),
    "availability_override" character varying(20),
    "prep_time_override" integer,
    "stock_quantity_override" integer,
    "is_included" boolean default true,
    "display_order_override" integer,
    "is_featured_at_event" boolean default false,
    "max_orders_per_customer" integer,
    "max_total_orders" integer,
    "current_order_count" integer default 0,
    "available_from" timestamp with time zone,
    "available_to" timestamp with time zone,
    "event_notes" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."event_vendors" (
    "event_id" uuid not null,
    "vendor_id" uuid not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."events" (
    "id" uuid not null default gen_random_uuid(),
    "name" character varying(255) not null,
    "description" text,
    "start_date" timestamp with time zone not null,
    "end_date" timestamp with time zone not null,
    "location" jsonb not null,
    "image_url" text,
    "is_public" boolean not null default false,
    "status" public.event_status not null default 'ACTIVE'::public.event_status,
    "code" character varying(50) not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "timezone" text not null default 'UTC'::text,
    "branding" jsonb
      );



  create table "public"."menu_categories" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "parent_id" uuid,
    "name" character varying(100) not null,
    "slug" character varying(120) not null,
    "description" text,
    "image_url" text,
    "display_order" integer default 0,
    "is_active" boolean default true,
    "schedule_start" time without time zone,
    "schedule_end" time without time zone,
    "available_days" integer[],
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."menu_item_analytics" (
    "id" uuid not null default gen_random_uuid(),
    "menu_item_id" uuid not null,
    "event_id" uuid,
    "period_start" date not null,
    "period_end" date not null,
    "total_orders" integer default 0,
    "total_quantity" integer default 0,
    "total_revenue" numeric(12,2) default 0,
    "view_count" integer default 0,
    "add_to_cart_count" integer default 0,
    "average_prep_time" integer,
    "average_rating" numeric(3,2),
    "total_ratings" integer default 0,
    "stockout_count" integer default 0,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."menu_item_analytics" enable row level security;


  create table "public"."menu_item_tags" (
    "menu_item_id" uuid not null,
    "tag_id" uuid not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."menu_tags" (
    "id" uuid not null default gen_random_uuid(),
    "name" character varying(50) not null,
    "slug" character varying(60) not null,
    "description" character varying(200),
    "color" character varying(7),
    "icon" character varying(50),
    "category" character varying(20) not null,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );


alter table "public"."menu_tags" enable row level security;


  create table "public"."menu_templates" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "name" character varying(100) not null,
    "description" text,
    "template_type" character varying(20) not null,
    "included_category_ids" uuid[] default '{}'::uuid[],
    "included_item_ids" uuid[] default '{}'::uuid[],
    "excluded_item_ids" uuid[] default '{}'::uuid[],
    "default_price_adjustment" jsonb,
    "default_prep_time_adjustment" integer,
    "item_overrides" jsonb default '[]'::jsonb,
    "is_default" boolean default false,
    "usage_count" integer default 0,
    "last_used_at" timestamp with time zone,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."modifier_groups" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "name" character varying(100) not null,
    "description" text,
    "selection_type" character varying(10) not null,
    "is_required" boolean default false,
    "min_selections" integer default 0,
    "max_selections" integer default 1,
    "display_order" integer default 0,
    "is_active" boolean default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."modifiers" (
    "id" uuid not null default gen_random_uuid(),
    "group_id" uuid not null,
    "name" character varying(100) not null,
    "description" text,
    "price_adjustment" numeric(10,2) default 0,
    "is_default" boolean default false,
    "is_available" boolean default true,
    "display_order" integer default 0,
    "nutritional_info" jsonb,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."orders" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "event_id" uuid not null,
    "phone" character varying(20) not null,
    "items" jsonb not null,
    "total" numeric(10,2) not null,
    "status" public.order_status not null default 'PENDING'::public.order_status,
    "type" public.order_type not null default 'CART'::public.order_type,
    "notes" text,
    "estimated_prep_time" integer,
    "payment_method" character varying(50),
    "qr_code" character varying(255) not null,
    "qr_image" text,
    "created_at" timestamp with time zone default now(),
    "collected_at" timestamp with time zone,
    "prepared_at" timestamp with time zone,
    "ready_at" timestamp with time zone,
    "scheduled_pickup_time" timestamp with time zone,
    "actual_prep_time" integer,
    "queue_position" integer,
    "estimated_ready_time" timestamp with time zone
      );



  create table "public"."organizer_invites" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "token" text not null,
    "expires_at" timestamp with time zone not null,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."organizer_password_resets" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "token" text not null,
    "expires_at" timestamp with time zone not null,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."organizer_users" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "name" text not null default ''::text,
    "password_hash" text not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."tags" (
    "id" uuid not null default gen_random_uuid(),
    "name" character varying(100) not null,
    "description" text,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."vendor_event_hours" (
    "id" uuid not null default gen_random_uuid(),
    "event_id" uuid not null,
    "vendor_id" uuid not null,
    "date" date not null,
    "open_time" text not null,
    "close_time" text not null,
    "is_closed" boolean not null default false
      );



  create table "public"."vendor_invites" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "email" text not null,
    "token" text not null,
    "expires_at" timestamp with time zone not null,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."vendor_menu_items" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "category_id" uuid not null,
    "name" character varying(255) not null,
    "description" text,
    "price" numeric(10,2) not null,
    "image_url" text,
    "type" public.menu_item_type not null default 'FOOD'::public.menu_item_type,
    "prep_time" integer,
    "available" boolean not null default true,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."vendor_password_resets" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "token" text not null,
    "expires_at" timestamp with time zone not null,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );



  create table "public"."vendor_users" (
    "id" uuid not null default gen_random_uuid(),
    "vendor_id" uuid not null,
    "email" text not null,
    "password_hash" text not null,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."vendors" (
    "id" uuid not null default gen_random_uuid(),
    "name" character varying(255) not null,
    "description" text,
    "email" character varying(255) not null,
    "phone" character varying(20) not null,
    "logo_url" text,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now(),
    "category_id" uuid,
    "image_url" text,
    "cuisine_type" text[],
    "rating" numeric(3,2),
    "total_reviews" integer default 0,
    "location" jsonb,
    "hours" jsonb default '[]'::jsonb,
    "is_active" boolean not null default true,
    "is_paused" boolean not null default false,
    "minimum_order" numeric(10,2),
    "delivery_fee" numeric(10,2),
    "estimated_prep_time" integer,
    "payment_methods" text[] default '{}'::text[],
    "service_fee_percent" numeric(5,2)
      );


CREATE UNIQUE INDEX categories_name_key ON public.categories USING btree (name);

CREATE UNIQUE INDEX categories_pkey ON public.categories USING btree (id);

CREATE UNIQUE INDEX default_menu_items_pkey ON public.default_menu_items USING btree (id);

CREATE UNIQUE INDEX default_menu_items_vendor_id_slug_key ON public.default_menu_items USING btree (vendor_id, slug);

CREATE UNIQUE INDEX discounts_pkey ON public.discounts USING btree (id);

CREATE UNIQUE INDEX event_day_hours_pkey ON public.event_day_hours USING btree (id);

CREATE UNIQUE INDEX event_menu_configurations_event_id_vendor_id_key ON public.event_menu_configurations USING btree (event_id, vendor_id);

CREATE UNIQUE INDEX event_menu_configurations_pkey ON public.event_menu_configurations USING btree (id);

CREATE UNIQUE INDEX event_menu_items_event_id_vendor_id_default_menu_item_id_key ON public.event_menu_items USING btree (event_id, vendor_id, default_menu_item_id);

CREATE UNIQUE INDEX event_menu_items_pkey ON public.event_menu_items USING btree (id);

CREATE UNIQUE INDEX event_vendors_event_id_vendor_id_key ON public.event_vendors USING btree (event_id, vendor_id);

CREATE UNIQUE INDEX event_vendors_pkey ON public.event_vendors USING btree (event_id, vendor_id);

CREATE UNIQUE INDEX events_code_key ON public.events USING btree (code);

CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);

CREATE INDEX idx_categories_name ON public.categories USING btree (name);

CREATE INDEX idx_categories_type ON public.categories USING btree (type);

CREATE INDEX idx_default_menu_items_active ON public.default_menu_items USING btree (vendor_id, is_active);

CREATE INDEX idx_default_menu_items_category ON public.default_menu_items USING btree (category_id);

CREATE INDEX idx_default_menu_items_featured ON public.default_menu_items USING btree (vendor_id, is_featured) WHERE (is_featured = true);

CREATE INDEX idx_default_menu_items_tags ON public.default_menu_items USING gin (tag_ids);

CREATE INDEX idx_default_menu_items_type ON public.default_menu_items USING btree (type);

CREATE INDEX idx_default_menu_items_vendor ON public.default_menu_items USING btree (vendor_id);

CREATE INDEX idx_discounts_event ON public.discounts USING btree (event_id) WHERE (is_active = true);

CREATE INDEX idx_discounts_event_vendor ON public.discounts USING btree (event_id, vendor_id);

CREATE INDEX idx_event_day_hours_event_date ON public.event_day_hours USING btree (event_id, date);

CREATE INDEX idx_event_menu_config_event ON public.event_menu_configurations USING btree (event_id);

CREATE INDEX idx_event_menu_config_status ON public.event_menu_configurations USING btree (status);

CREATE INDEX idx_event_menu_config_vendor ON public.event_menu_configurations USING btree (vendor_id);

CREATE INDEX idx_event_menu_items_default ON public.event_menu_items USING btree (default_menu_item_id);

CREATE INDEX idx_event_menu_items_event ON public.event_menu_items USING btree (event_id);

CREATE INDEX idx_event_menu_items_featured ON public.event_menu_items USING btree (event_id, vendor_id, is_featured_at_event) WHERE (is_featured_at_event = true);

CREATE INDEX idx_event_menu_items_included ON public.event_menu_items USING btree (event_id, vendor_id, is_included) WHERE (is_included = true);

CREATE INDEX idx_event_menu_items_vendor ON public.event_menu_items USING btree (vendor_id);

CREATE INDEX idx_event_vendors_event_id ON public.event_vendors USING btree (event_id);

CREATE INDEX idx_event_vendors_vendor_id ON public.event_vendors USING btree (vendor_id);

CREATE INDEX idx_events_code ON public.events USING btree (code);

CREATE INDEX idx_events_created_at ON public.events USING btree (created_at DESC);

CREATE INDEX idx_events_date_range ON public.events USING btree (start_date, end_date);

CREATE INDEX idx_events_end_date ON public.events USING btree (end_date);

CREATE INDEX idx_events_is_public ON public.events USING btree (is_public);

CREATE INDEX idx_events_location ON public.events USING gin (location);

CREATE INDEX idx_events_start_date ON public.events USING btree (start_date);

CREATE INDEX idx_events_status ON public.events USING btree (status);

CREATE INDEX idx_events_status_public ON public.events USING btree (status, is_public);

CREATE INDEX idx_menu_analytics_event ON public.menu_item_analytics USING btree (event_id);

CREATE INDEX idx_menu_analytics_item ON public.menu_item_analytics USING btree (menu_item_id);

CREATE INDEX idx_menu_analytics_period ON public.menu_item_analytics USING btree (period_start, period_end);

CREATE INDEX idx_menu_categories_active ON public.menu_categories USING btree (vendor_id, is_active);

CREATE INDEX idx_menu_categories_parent ON public.menu_categories USING btree (parent_id);

CREATE INDEX idx_menu_categories_vendor ON public.menu_categories USING btree (vendor_id);

CREATE INDEX idx_menu_item_tags_menu_item ON public.menu_item_tags USING btree (menu_item_id);

CREATE INDEX idx_menu_item_tags_tag ON public.menu_item_tags USING btree (tag_id);

CREATE INDEX idx_menu_items_available ON public.vendor_menu_items USING btree (available);

CREATE INDEX idx_menu_items_category_id ON public.vendor_menu_items USING btree (category_id);

CREATE INDEX idx_menu_items_price ON public.vendor_menu_items USING btree (price);

CREATE INDEX idx_menu_items_type ON public.vendor_menu_items USING btree (type);

CREATE INDEX idx_menu_items_vendor_available ON public.vendor_menu_items USING btree (vendor_id, available);

CREATE INDEX idx_menu_items_vendor_category ON public.vendor_menu_items USING btree (vendor_id, category_id);

CREATE INDEX idx_menu_items_vendor_id ON public.vendor_menu_items USING btree (vendor_id);

CREATE INDEX idx_menu_items_vendor_type ON public.vendor_menu_items USING btree (vendor_id, type);

CREATE INDEX idx_menu_tags_active ON public.menu_tags USING btree (is_active);

CREATE INDEX idx_menu_tags_category ON public.menu_tags USING btree (category);

CREATE INDEX idx_menu_templates_default ON public.menu_templates USING btree (vendor_id, is_default) WHERE (is_default = true);

CREATE INDEX idx_menu_templates_type ON public.menu_templates USING btree (template_type);

CREATE INDEX idx_menu_templates_vendor ON public.menu_templates USING btree (vendor_id);

CREATE INDEX idx_modifier_groups_vendor ON public.modifier_groups USING btree (vendor_id);

CREATE INDEX idx_modifiers_group ON public.modifiers USING btree (group_id);

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);

CREATE INDEX idx_orders_event_id ON public.orders USING btree (event_id);

CREATE INDEX idx_orders_event_scheduled ON public.orders USING btree (event_id, scheduled_pickup_time) WHERE (scheduled_pickup_time IS NOT NULL);

CREATE INDEX idx_orders_event_status ON public.orders USING btree (event_id, status);

CREATE INDEX idx_orders_items ON public.orders USING gin (items);

CREATE INDEX idx_orders_phone ON public.orders USING btree (phone);

CREATE INDEX idx_orders_phone_type ON public.orders USING btree (phone, type);

CREATE INDEX idx_orders_qr_code ON public.orders USING btree (qr_code);

CREATE INDEX idx_orders_scheduled_pickup_time ON public.orders USING btree (scheduled_pickup_time) WHERE (scheduled_pickup_time IS NOT NULL);

CREATE INDEX idx_orders_status ON public.orders USING btree (status);

CREATE INDEX idx_orders_type ON public.orders USING btree (type);

CREATE INDEX idx_orders_vendor_id ON public.orders USING btree (vendor_id);

CREATE INDEX idx_orders_vendor_status ON public.orders USING btree (vendor_id, status);

CREATE INDEX idx_orders_vendor_status_scheduled ON public.orders USING btree (vendor_id, status, scheduled_pickup_time) WHERE (status = ANY (ARRAY['PENDING'::public.order_status, 'PREPARING'::public.order_status]));

CREATE INDEX idx_tags_name ON public.tags USING btree (name);

CREATE INDEX idx_vendor_event_hours_vendor_event_date ON public.vendor_event_hours USING btree (vendor_id, event_id, date);

CREATE INDEX idx_vendor_invites_token ON public.vendor_invites USING btree (token);

CREATE INDEX idx_vendor_users_email ON public.vendor_users USING btree (email);

CREATE INDEX idx_vendor_users_vendor_id ON public.vendor_users USING btree (vendor_id);

CREATE INDEX idx_vendors_active_category ON public.vendors USING btree (is_active, category_id);

CREATE INDEX idx_vendors_category_id ON public.vendors USING btree (category_id);

CREATE INDEX idx_vendors_created_at ON public.vendors USING btree (created_at DESC);

CREATE INDEX idx_vendors_cuisine_type ON public.vendors USING gin (cuisine_type);

CREATE INDEX idx_vendors_email ON public.vendors USING btree (email);

CREATE INDEX idx_vendors_hours ON public.vendors USING gin (hours);

CREATE INDEX idx_vendors_is_active ON public.vendors USING btree (is_active);

CREATE INDEX idx_vendors_is_paused ON public.vendors USING btree (is_paused);

CREATE INDEX idx_vendors_location ON public.vendors USING gin (location);

CREATE INDEX idx_vendors_name ON public.vendors USING btree (name);

CREATE INDEX idx_vendors_payment_methods ON public.vendors USING gin (payment_methods);

CREATE INDEX idx_vendors_rating ON public.vendors USING btree (rating DESC);

CREATE UNIQUE INDEX menu_categories_pkey ON public.menu_categories USING btree (id);

CREATE UNIQUE INDEX menu_categories_vendor_id_slug_key ON public.menu_categories USING btree (vendor_id, slug);

CREATE UNIQUE INDEX menu_item_analytics_menu_item_id_event_id_period_start_peri_key ON public.menu_item_analytics USING btree (menu_item_id, event_id, period_start, period_end);

CREATE UNIQUE INDEX menu_item_analytics_pkey ON public.menu_item_analytics USING btree (id);

CREATE UNIQUE INDEX menu_item_tags_pkey ON public.menu_item_tags USING btree (menu_item_id, tag_id);

CREATE UNIQUE INDEX menu_tags_pkey ON public.menu_tags USING btree (id);

CREATE UNIQUE INDEX menu_tags_slug_key ON public.menu_tags USING btree (slug);

CREATE UNIQUE INDEX menu_templates_pkey ON public.menu_templates USING btree (id);

CREATE UNIQUE INDEX modifier_groups_pkey ON public.modifier_groups USING btree (id);

CREATE UNIQUE INDEX modifiers_pkey ON public.modifiers USING btree (id);

CREATE UNIQUE INDEX orders_pkey ON public.orders USING btree (id);

CREATE UNIQUE INDEX orders_qr_code_key ON public.orders USING btree (qr_code);

CREATE UNIQUE INDEX organizer_invites_pkey ON public.organizer_invites USING btree (id);

CREATE UNIQUE INDEX organizer_invites_token_key ON public.organizer_invites USING btree (token);

CREATE UNIQUE INDEX organizer_password_resets_pkey ON public.organizer_password_resets USING btree (id);

CREATE UNIQUE INDEX organizer_password_resets_token_key ON public.organizer_password_resets USING btree (token);

CREATE UNIQUE INDEX organizer_users_email_key ON public.organizer_users USING btree (email);

CREATE UNIQUE INDEX organizer_users_pkey ON public.organizer_users USING btree (id);

CREATE UNIQUE INDEX tags_name_key ON public.tags USING btree (name);

CREATE UNIQUE INDEX tags_pkey ON public.tags USING btree (id);

CREATE UNIQUE INDEX uq_event_day ON public.event_day_hours USING btree (event_id, date);

CREATE UNIQUE INDEX uq_vendor_event_day ON public.vendor_event_hours USING btree (event_id, vendor_id, date);

CREATE UNIQUE INDEX vendor_event_hours_pkey ON public.vendor_event_hours USING btree (id);

CREATE UNIQUE INDEX vendor_invites_pkey ON public.vendor_invites USING btree (id);

CREATE UNIQUE INDEX vendor_invites_token_key ON public.vendor_invites USING btree (token);

CREATE UNIQUE INDEX vendor_menu_items_pkey ON public.vendor_menu_items USING btree (id);

CREATE INDEX vendor_password_resets_email_idx ON public.vendor_password_resets USING btree (email);

CREATE UNIQUE INDEX vendor_password_resets_pkey ON public.vendor_password_resets USING btree (id);

CREATE INDEX vendor_password_resets_token_idx ON public.vendor_password_resets USING btree (token);

CREATE UNIQUE INDEX vendor_password_resets_token_key ON public.vendor_password_resets USING btree (token);

CREATE UNIQUE INDEX vendor_users_email_key ON public.vendor_users USING btree (email);

CREATE UNIQUE INDEX vendor_users_pkey ON public.vendor_users USING btree (id);

CREATE UNIQUE INDEX vendors_email_key ON public.vendors USING btree (email);

CREATE UNIQUE INDEX vendors_pkey ON public.vendors USING btree (id);

alter table "public"."categories" add constraint "categories_pkey" PRIMARY KEY using index "categories_pkey";

alter table "public"."default_menu_items" add constraint "default_menu_items_pkey" PRIMARY KEY using index "default_menu_items_pkey";

alter table "public"."discounts" add constraint "discounts_pkey" PRIMARY KEY using index "discounts_pkey";

alter table "public"."event_day_hours" add constraint "event_day_hours_pkey" PRIMARY KEY using index "event_day_hours_pkey";

alter table "public"."event_menu_configurations" add constraint "event_menu_configurations_pkey" PRIMARY KEY using index "event_menu_configurations_pkey";

alter table "public"."event_menu_items" add constraint "event_menu_items_pkey" PRIMARY KEY using index "event_menu_items_pkey";

alter table "public"."event_vendors" add constraint "event_vendors_pkey" PRIMARY KEY using index "event_vendors_pkey";

alter table "public"."events" add constraint "events_pkey" PRIMARY KEY using index "events_pkey";

alter table "public"."menu_categories" add constraint "menu_categories_pkey" PRIMARY KEY using index "menu_categories_pkey";

alter table "public"."menu_item_analytics" add constraint "menu_item_analytics_pkey" PRIMARY KEY using index "menu_item_analytics_pkey";

alter table "public"."menu_item_tags" add constraint "menu_item_tags_pkey" PRIMARY KEY using index "menu_item_tags_pkey";

alter table "public"."menu_tags" add constraint "menu_tags_pkey" PRIMARY KEY using index "menu_tags_pkey";

alter table "public"."menu_templates" add constraint "menu_templates_pkey" PRIMARY KEY using index "menu_templates_pkey";

alter table "public"."modifier_groups" add constraint "modifier_groups_pkey" PRIMARY KEY using index "modifier_groups_pkey";

alter table "public"."modifiers" add constraint "modifiers_pkey" PRIMARY KEY using index "modifiers_pkey";

alter table "public"."orders" add constraint "orders_pkey" PRIMARY KEY using index "orders_pkey";

alter table "public"."organizer_invites" add constraint "organizer_invites_pkey" PRIMARY KEY using index "organizer_invites_pkey";

alter table "public"."organizer_password_resets" add constraint "organizer_password_resets_pkey" PRIMARY KEY using index "organizer_password_resets_pkey";

alter table "public"."organizer_users" add constraint "organizer_users_pkey" PRIMARY KEY using index "organizer_users_pkey";

alter table "public"."tags" add constraint "tags_pkey" PRIMARY KEY using index "tags_pkey";

alter table "public"."vendor_event_hours" add constraint "vendor_event_hours_pkey" PRIMARY KEY using index "vendor_event_hours_pkey";

alter table "public"."vendor_invites" add constraint "vendor_invites_pkey" PRIMARY KEY using index "vendor_invites_pkey";

alter table "public"."vendor_menu_items" add constraint "vendor_menu_items_pkey" PRIMARY KEY using index "vendor_menu_items_pkey";

alter table "public"."vendor_password_resets" add constraint "vendor_password_resets_pkey" PRIMARY KEY using index "vendor_password_resets_pkey";

alter table "public"."vendor_users" add constraint "vendor_users_pkey" PRIMARY KEY using index "vendor_users_pkey";

alter table "public"."vendors" add constraint "vendors_pkey" PRIMARY KEY using index "vendors_pkey";

alter table "public"."categories" add constraint "categories_name_key" UNIQUE using index "categories_name_key";

alter table "public"."categories" add constraint "categories_name_not_empty" CHECK ((char_length((name)::text) > 0)) not valid;

alter table "public"."categories" validate constraint "categories_name_not_empty";

alter table "public"."categories" add constraint "categories_type_valid" CHECK (((type)::text = ANY ((ARRAY['VENDOR'::character varying, 'MENU_ITEM'::character varying])::text[]))) not valid;

alter table "public"."categories" validate constraint "categories_type_valid";

alter table "public"."default_menu_items" add constraint "default_menu_items_availability_status_check" CHECK (((availability_status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'OUT_OF_STOCK'::character varying, 'LIMITED'::character varying, 'COMING_SOON'::character varying, 'DISCONTINUED'::character varying])::text[]))) not valid;

alter table "public"."default_menu_items" validate constraint "default_menu_items_availability_status_check";

alter table "public"."default_menu_items" add constraint "default_menu_items_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.menu_categories(id) ON DELETE RESTRICT not valid;

alter table "public"."default_menu_items" validate constraint "default_menu_items_category_id_fkey";

alter table "public"."default_menu_items" add constraint "default_menu_items_pricing_strategy_check" CHECK (((pricing_strategy)::text = ANY ((ARRAY['FIXED'::character varying, 'TIERED'::character varying, 'TIME_BASED'::character varying, 'DYNAMIC'::character varying])::text[]))) not valid;

alter table "public"."default_menu_items" validate constraint "default_menu_items_pricing_strategy_check";

alter table "public"."default_menu_items" add constraint "default_menu_items_type_check" CHECK (((type)::text = ANY ((ARRAY['FOOD'::character varying, 'BEVERAGE'::character varying, 'RETAIL'::character varying, 'SERVICE'::character varying])::text[]))) not valid;

alter table "public"."default_menu_items" validate constraint "default_menu_items_type_check";

alter table "public"."default_menu_items" add constraint "default_menu_items_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."default_menu_items" validate constraint "default_menu_items_vendor_id_fkey";

alter table "public"."default_menu_items" add constraint "default_menu_items_vendor_id_slug_key" UNIQUE using index "default_menu_items_vendor_id_slug_key";

alter table "public"."discounts" add constraint "discounts_created_by_check" CHECK ((created_by = ANY (ARRAY['ORGANIZER'::text, 'VENDOR'::text]))) not valid;

alter table "public"."discounts" validate constraint "discounts_created_by_check";

alter table "public"."discounts" add constraint "discounts_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."discounts" validate constraint "discounts_event_id_fkey";

alter table "public"."discounts" add constraint "discounts_scope_check" CHECK ((scope = ANY (ARRAY['EVENT'::text, 'ITEM'::text]))) not valid;

alter table "public"."discounts" validate constraint "discounts_scope_check";

alter table "public"."discounts" add constraint "discounts_type_check" CHECK ((type = ANY (ARRAY['PERCENTAGE'::text, 'FIXED'::text]))) not valid;

alter table "public"."discounts" validate constraint "discounts_type_check";

alter table "public"."discounts" add constraint "discounts_value_check" CHECK ((value > (0)::numeric)) not valid;

alter table "public"."discounts" validate constraint "discounts_value_check";

alter table "public"."discounts" add constraint "discounts_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."discounts" validate constraint "discounts_vendor_id_fkey";

alter table "public"."event_day_hours" add constraint "ck_event_day_close_time" CHECK ((close_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text)) not valid;

alter table "public"."event_day_hours" validate constraint "ck_event_day_close_time";

alter table "public"."event_day_hours" add constraint "ck_event_day_open_time" CHECK ((open_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text)) not valid;

alter table "public"."event_day_hours" validate constraint "ck_event_day_open_time";

alter table "public"."event_day_hours" add constraint "event_day_hours_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."event_day_hours" validate constraint "event_day_hours_event_id_fkey";

alter table "public"."event_day_hours" add constraint "uq_event_day" UNIQUE using index "uq_event_day";

alter table "public"."event_menu_configurations" add constraint "event_menu_configurations_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."event_menu_configurations" validate constraint "event_menu_configurations_event_id_fkey";

alter table "public"."event_menu_configurations" add constraint "event_menu_configurations_event_id_vendor_id_key" UNIQUE using index "event_menu_configurations_event_id_vendor_id_key";

alter table "public"."event_menu_configurations" add constraint "event_menu_configurations_status_check" CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'PENDING_APPROVAL'::character varying, 'APPROVED'::character varying, 'PUBLISHED'::character varying, 'PAUSED'::character varying, 'CLOSED'::character varying])::text[]))) not valid;

alter table "public"."event_menu_configurations" validate constraint "event_menu_configurations_status_check";

alter table "public"."event_menu_configurations" add constraint "event_menu_configurations_template_id_fkey" FOREIGN KEY (template_id) REFERENCES public.menu_templates(id) ON DELETE SET NULL not valid;

alter table "public"."event_menu_configurations" validate constraint "event_menu_configurations_template_id_fkey";

alter table "public"."event_menu_configurations" add constraint "event_menu_configurations_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."event_menu_configurations" validate constraint "event_menu_configurations_vendor_id_fkey";

alter table "public"."event_menu_items" add constraint "event_menu_items_availability_override_check" CHECK (((availability_override)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'OUT_OF_STOCK'::character varying, 'LIMITED'::character varying, 'COMING_SOON'::character varying, 'DISCONTINUED'::character varying])::text[]))) not valid;

alter table "public"."event_menu_items" validate constraint "event_menu_items_availability_override_check";

alter table "public"."event_menu_items" add constraint "event_menu_items_default_menu_item_id_fkey" FOREIGN KEY (default_menu_item_id) REFERENCES public.default_menu_items(id) ON DELETE CASCADE not valid;

alter table "public"."event_menu_items" validate constraint "event_menu_items_default_menu_item_id_fkey";

alter table "public"."event_menu_items" add constraint "event_menu_items_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."event_menu_items" validate constraint "event_menu_items_event_id_fkey";

alter table "public"."event_menu_items" add constraint "event_menu_items_event_id_vendor_id_default_menu_item_id_key" UNIQUE using index "event_menu_items_event_id_vendor_id_default_menu_item_id_key";

alter table "public"."event_menu_items" add constraint "event_menu_items_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."event_menu_items" validate constraint "event_menu_items_vendor_id_fkey";

alter table "public"."event_vendors" add constraint "event_vendors_event_id_vendor_id_key" UNIQUE using index "event_vendors_event_id_vendor_id_key";

alter table "public"."event_vendors" add constraint "fk_event" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."event_vendors" validate constraint "fk_event";

alter table "public"."event_vendors" add constraint "fk_vendor" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."event_vendors" validate constraint "fk_vendor";

alter table "public"."events" add constraint "events_code_key" UNIQUE using index "events_code_key";

alter table "public"."events" add constraint "events_code_not_empty" CHECK ((char_length((code)::text) > 0)) not valid;

alter table "public"."events" validate constraint "events_code_not_empty";

alter table "public"."events" add constraint "events_dates_valid" CHECK ((end_date > start_date)) not valid;

alter table "public"."events" validate constraint "events_dates_valid";

alter table "public"."events" add constraint "events_name_not_empty" CHECK ((char_length((name)::text) > 0)) not valid;

alter table "public"."events" validate constraint "events_name_not_empty";

alter table "public"."menu_categories" add constraint "menu_categories_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES public.menu_categories(id) ON DELETE SET NULL not valid;

alter table "public"."menu_categories" validate constraint "menu_categories_parent_id_fkey";

alter table "public"."menu_categories" add constraint "menu_categories_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."menu_categories" validate constraint "menu_categories_vendor_id_fkey";

alter table "public"."menu_categories" add constraint "menu_categories_vendor_id_slug_key" UNIQUE using index "menu_categories_vendor_id_slug_key";

alter table "public"."menu_item_analytics" add constraint "menu_item_analytics_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."menu_item_analytics" validate constraint "menu_item_analytics_event_id_fkey";

alter table "public"."menu_item_analytics" add constraint "menu_item_analytics_menu_item_id_event_id_period_start_peri_key" UNIQUE using index "menu_item_analytics_menu_item_id_event_id_period_start_peri_key";

alter table "public"."menu_item_analytics" add constraint "menu_item_analytics_menu_item_id_fkey" FOREIGN KEY (menu_item_id) REFERENCES public.default_menu_items(id) ON DELETE CASCADE not valid;

alter table "public"."menu_item_analytics" validate constraint "menu_item_analytics_menu_item_id_fkey";

alter table "public"."menu_item_tags" add constraint "fk_menu_item" FOREIGN KEY (menu_item_id) REFERENCES public.vendor_menu_items(id) ON DELETE CASCADE not valid;

alter table "public"."menu_item_tags" validate constraint "fk_menu_item";

alter table "public"."menu_item_tags" add constraint "fk_tag" FOREIGN KEY (tag_id) REFERENCES public.tags(id) ON DELETE CASCADE not valid;

alter table "public"."menu_item_tags" validate constraint "fk_tag";

alter table "public"."menu_tags" add constraint "menu_tags_category_check" CHECK (((category)::text = ANY ((ARRAY['DIETARY'::character varying, 'ALLERGEN'::character varying, 'SPICE_LEVEL'::character varying, 'CUISINE'::character varying, 'PREPARATION'::character varying, 'FEATURE'::character varying, 'CUSTOM'::character varying])::text[]))) not valid;

alter table "public"."menu_tags" validate constraint "menu_tags_category_check";

alter table "public"."menu_tags" add constraint "menu_tags_slug_key" UNIQUE using index "menu_tags_slug_key";

alter table "public"."menu_templates" add constraint "menu_templates_template_type_check" CHECK (((template_type)::text = ANY ((ARRAY['FULL_MENU'::character varying, 'FESTIVAL'::character varying, 'CORPORATE'::character varying, 'QUICK_SERVICE'::character varying, 'PREMIUM'::character varying, 'BREAKFAST'::character varying, 'LUNCH'::character varying, 'DINNER'::character varying, 'CUSTOM'::character varying])::text[]))) not valid;

alter table "public"."menu_templates" validate constraint "menu_templates_template_type_check";

alter table "public"."menu_templates" add constraint "menu_templates_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."menu_templates" validate constraint "menu_templates_vendor_id_fkey";

alter table "public"."modifier_groups" add constraint "modifier_groups_selection_type_check" CHECK (((selection_type)::text = ANY ((ARRAY['SINGLE'::character varying, 'MULTIPLE'::character varying])::text[]))) not valid;

alter table "public"."modifier_groups" validate constraint "modifier_groups_selection_type_check";

alter table "public"."modifier_groups" add constraint "modifier_groups_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."modifier_groups" validate constraint "modifier_groups_vendor_id_fkey";

alter table "public"."modifiers" add constraint "modifiers_group_id_fkey" FOREIGN KEY (group_id) REFERENCES public.modifier_groups(id) ON DELETE CASCADE not valid;

alter table "public"."modifiers" validate constraint "modifiers_group_id_fkey";

alter table "public"."orders" add constraint "check_actual_prep_time_positive" CHECK (((actual_prep_time IS NULL) OR (actual_prep_time > 0))) not valid;

alter table "public"."orders" validate constraint "check_actual_prep_time_positive";

alter table "public"."orders" add constraint "check_queue_position_positive" CHECK (((queue_position IS NULL) OR (queue_position > 0))) not valid;

alter table "public"."orders" validate constraint "check_queue_position_positive";

alter table "public"."orders" add constraint "check_scheduled_pickup_future" CHECK (((scheduled_pickup_time IS NULL) OR (scheduled_pickup_time > created_at))) not valid;

alter table "public"."orders" validate constraint "check_scheduled_pickup_future";

alter table "public"."orders" add constraint "fk_event" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."orders" validate constraint "fk_event";

alter table "public"."orders" add constraint "fk_vendor" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."orders" validate constraint "fk_vendor";

alter table "public"."orders" add constraint "orders_prep_time_positive" CHECK (((estimated_prep_time IS NULL) OR (estimated_prep_time >= 0))) not valid;

alter table "public"."orders" validate constraint "orders_prep_time_positive";

alter table "public"."orders" add constraint "orders_qr_code_key" UNIQUE using index "orders_qr_code_key";

alter table "public"."orders" add constraint "orders_total_positive" CHECK ((total >= (0)::numeric)) not valid;

alter table "public"."orders" validate constraint "orders_total_positive";

alter table "public"."organizer_invites" add constraint "organizer_invites_token_key" UNIQUE using index "organizer_invites_token_key";

alter table "public"."organizer_password_resets" add constraint "organizer_password_resets_token_key" UNIQUE using index "organizer_password_resets_token_key";

alter table "public"."organizer_users" add constraint "organizer_users_email_key" UNIQUE using index "organizer_users_email_key";

alter table "public"."tags" add constraint "tags_name_key" UNIQUE using index "tags_name_key";

alter table "public"."tags" add constraint "tags_name_not_empty" CHECK ((char_length((name)::text) > 0)) not valid;

alter table "public"."tags" validate constraint "tags_name_not_empty";

alter table "public"."vendor_event_hours" add constraint "ck_vendor_event_close_time" CHECK ((close_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text)) not valid;

alter table "public"."vendor_event_hours" validate constraint "ck_vendor_event_close_time";

alter table "public"."vendor_event_hours" add constraint "ck_vendor_event_open_time" CHECK ((open_time ~ '^[0-2][0-9]:[0-5][0-9]$'::text)) not valid;

alter table "public"."vendor_event_hours" validate constraint "ck_vendor_event_open_time";

alter table "public"."vendor_event_hours" add constraint "uq_vendor_event_day" UNIQUE using index "uq_vendor_event_day";

alter table "public"."vendor_event_hours" add constraint "vendor_event_hours_event_id_fkey" FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE not valid;

alter table "public"."vendor_event_hours" validate constraint "vendor_event_hours_event_id_fkey";

alter table "public"."vendor_event_hours" add constraint "vendor_event_hours_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."vendor_event_hours" validate constraint "vendor_event_hours_vendor_id_fkey";

alter table "public"."vendor_invites" add constraint "vendor_invites_token_key" UNIQUE using index "vendor_invites_token_key";

alter table "public"."vendor_invites" add constraint "vendor_invites_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."vendor_invites" validate constraint "vendor_invites_vendor_id_fkey";

alter table "public"."vendor_menu_items" add constraint "fk_menu_category" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT not valid;

alter table "public"."vendor_menu_items" validate constraint "fk_menu_category";

alter table "public"."vendor_menu_items" add constraint "fk_menu_vendor" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."vendor_menu_items" validate constraint "fk_menu_vendor";

alter table "public"."vendor_menu_items" add constraint "menu_items_name_not_empty" CHECK ((char_length((name)::text) > 0)) not valid;

alter table "public"."vendor_menu_items" validate constraint "menu_items_name_not_empty";

alter table "public"."vendor_menu_items" add constraint "menu_items_prep_time_food_only" CHECK (((type = 'FOOD'::public.menu_item_type) OR (prep_time IS NULL))) not valid;

alter table "public"."vendor_menu_items" validate constraint "menu_items_prep_time_food_only";

alter table "public"."vendor_menu_items" add constraint "menu_items_prep_time_positive" CHECK (((prep_time IS NULL) OR (prep_time >= 0))) not valid;

alter table "public"."vendor_menu_items" validate constraint "menu_items_prep_time_positive";

alter table "public"."vendor_menu_items" add constraint "menu_items_price_positive" CHECK ((price >= (0)::numeric)) not valid;

alter table "public"."vendor_menu_items" validate constraint "menu_items_price_positive";

alter table "public"."vendor_password_resets" add constraint "vendor_password_resets_token_key" UNIQUE using index "vendor_password_resets_token_key";

alter table "public"."vendor_users" add constraint "vendor_users_email_key" UNIQUE using index "vendor_users_email_key";

alter table "public"."vendor_users" add constraint "vendor_users_vendor_id_fkey" FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE not valid;

alter table "public"."vendor_users" validate constraint "vendor_users_vendor_id_fkey";

alter table "public"."vendors" add constraint "fk_vendor_category" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT not valid;

alter table "public"."vendors" validate constraint "fk_vendor_category";

alter table "public"."vendors" add constraint "vendors_delivery_fee_positive" CHECK (((delivery_fee IS NULL) OR (delivery_fee >= (0)::numeric))) not valid;

alter table "public"."vendors" validate constraint "vendors_delivery_fee_positive";

alter table "public"."vendors" add constraint "vendors_email_key" UNIQUE using index "vendors_email_key";

alter table "public"."vendors" add constraint "vendors_minimum_order_positive" CHECK (((minimum_order IS NULL) OR (minimum_order >= (0)::numeric))) not valid;

alter table "public"."vendors" validate constraint "vendors_minimum_order_positive";

alter table "public"."vendors" add constraint "vendors_name_not_empty" CHECK ((char_length((name)::text) > 0)) not valid;

alter table "public"."vendors" validate constraint "vendors_name_not_empty";

alter table "public"."vendors" add constraint "vendors_phone_not_empty" CHECK ((char_length((phone)::text) > 0)) not valid;

alter table "public"."vendors" validate constraint "vendors_phone_not_empty";

alter table "public"."vendors" add constraint "vendors_prep_time_positive" CHECK (((estimated_prep_time IS NULL) OR (estimated_prep_time >= 0))) not valid;

alter table "public"."vendors" validate constraint "vendors_prep_time_positive";

alter table "public"."vendors" add constraint "vendors_rating_valid" CHECK (((rating IS NULL) OR ((rating >= (0)::numeric) AND (rating <= (5)::numeric)))) not valid;

alter table "public"."vendors" validate constraint "vendors_rating_valid";

alter table "public"."vendors" add constraint "vendors_total_reviews_positive" CHECK ((total_reviews >= 0)) not valid;

alter table "public"."vendors" validate constraint "vendors_total_reviews_positive";

set check_function_bodies = off;

create or replace view "public"."active_vendors" as  SELECT id,
    name,
    description,
    email,
    phone,
    logo_url,
    created_at,
    updated_at,
    category_id,
    image_url,
    cuisine_type,
    rating,
    total_reviews,
    location,
    hours,
    is_active,
    is_paused,
    minimum_order,
    delivery_fee,
    estimated_prep_time,
    payment_methods
   FROM public.vendors
  WHERE ((is_active = true) AND (is_paused = false));


create or replace view "public"."events_with_vendor_count" as  SELECT e.id,
    e.name,
    e.description,
    e.start_date,
    e.end_date,
    e.location,
    e.image_url,
    e.is_public,
    e.status,
    e.code,
    e.created_at,
    e.updated_at,
    count(ev.vendor_id) AS vendor_count
   FROM (public.events e
     LEFT JOIN public.event_vendors ev ON ((e.id = ev.event_id)))
  GROUP BY e.id;


CREATE OR REPLACE FUNCTION public.get_available_menu_items(p_vendor_id uuid)
 RETURNS SETOF public.vendor_menu_items
 LANGUAGE sql
 STABLE
AS $function$
    SELECT *
    FROM vendor_menu_items
    WHERE vendor_id = p_vendor_id AND available = true
    ORDER BY category_id, name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_event_vendor_ids(p_event_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
    SELECT ARRAY_AGG(vendor_id::TEXT)
    FROM event_vendors
    WHERE event_id = p_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_menu_items_by_tag(p_tag_name text)
 RETURNS SETOF public.vendor_menu_items
 LANGUAGE sql
 STABLE
AS $function$
    SELECT m.*
    FROM vendor_menu_items m
    INNER JOIN menu_item_tags mt ON m.id = mt.menu_item_id
    INNER JOIN tags t ON mt.tag_id = t.id
    WHERE t.name = p_tag_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_menu_items_by_tags(p_tag_names text[])
 RETURNS SETOF public.vendor_menu_items
 LANGUAGE sql
 STABLE
AS $function$
    SELECT m.*
    FROM vendor_menu_items m
    WHERE m.id IN (
        SELECT menu_item_id
        FROM menu_item_tags mt
        INNER JOIN tags t ON mt.tag_id = t.id
        WHERE t.name = ANY(p_tag_names)
        GROUP BY menu_item_id
        HAVING COUNT(DISTINCT t.name) = array_length(p_tag_names, 1)
    );
$function$
;

CREATE OR REPLACE FUNCTION public.get_vendor_menu_items_by_type(p_vendor_id uuid, p_type public.menu_item_type)
 RETURNS SETOF public.vendor_menu_items
 LANGUAGE sql
 STABLE
AS $function$
    SELECT *
    FROM vendor_menu_items
    WHERE vendor_id = p_vendor_id AND type = p_type
    ORDER BY category_id, name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_vendors_by_category(p_category_id uuid)
 RETURNS SETOF public.vendors
 LANGUAGE sql
 STABLE
AS $function$
    SELECT *
    FROM vendors
    WHERE category_id = p_category_id AND is_active = true AND is_paused = false
    ORDER BY name;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_event_menu_item_order_count(p_event_id uuid, p_vendor_id uuid, p_menu_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE event_menu_items
    SET current_order_count = current_order_count + 1
    WHERE event_id = p_event_id
      AND vendor_id = p_vendor_id
      AND default_menu_item_id = p_menu_item_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_event_active(p_event_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    SELECT EXISTS(
        SELECT 1
        FROM events
        WHERE id = p_event_id
        AND start_date <= NOW()
        AND end_date > NOW()
        AND status = 'ACTIVE'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_menu_item_available(p_event_id uuid, p_vendor_id uuid, p_menu_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_is_included BOOLEAN;
    v_availability VARCHAR;
    v_max_orders INTEGER;
    v_current_orders INTEGER;
    v_available_from TIMESTAMPTZ;
    v_available_to TIMESTAMPTZ;
BEGIN
    SELECT 
        COALESCE(emi.is_included, true),
        COALESCE(emi.availability_override, dmi.availability_status),
        emi.max_total_orders,
        COALESCE(emi.current_order_count, 0),
        emi.available_from,
        emi.available_to
    INTO 
        v_is_included,
        v_availability,
        v_max_orders,
        v_current_orders,
        v_available_from,
        v_available_to
    FROM default_menu_items dmi
    LEFT JOIN event_menu_items emi 
        ON emi.default_menu_item_id = dmi.id 
        AND emi.event_id = p_event_id 
        AND emi.vendor_id = p_vendor_id
    WHERE dmi.id = p_menu_item_id
      AND dmi.vendor_id = p_vendor_id
      AND dmi.is_active = true;

    -- Check inclusion
    IF NOT v_is_included THEN
        RETURN false;
    END IF;

    -- Check availability status
    IF v_availability != 'AVAILABLE' THEN
        RETURN false;
    END IF;

    -- Check max orders limit
    IF v_max_orders IS NOT NULL AND v_current_orders >= v_max_orders THEN
        RETURN false;
    END IF;

    -- Check time-based availability
    IF v_available_from IS NOT NULL AND NOW() < v_available_from THEN
        RETURN false;
    END IF;

    IF v_available_to IS NOT NULL AND NOW() > v_available_to THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$function$
;

create or replace view "public"."menu_items_with_category" as  SELECT m.id,
    m.vendor_id,
    m.category_id,
    m.name,
    m.description,
    m.price,
    m.image_url,
    m.type,
    m.prep_time,
    m.available,
    m.created_at,
    m.updated_at,
    c.name AS category_name
   FROM (public.vendor_menu_items m
     LEFT JOIN public.categories c ON ((m.category_id = c.id)));


create or replace view "public"."menu_items_with_tags" as  SELECT m.id,
    m.vendor_id,
    m.category_id,
    m.name,
    m.description,
    m.price,
    m.image_url,
    m.type,
    m.prep_time,
    m.available,
    m.created_at,
    m.updated_at,
    c.name AS category_name,
    COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'description', t.description)) FILTER (WHERE (t.id IS NOT NULL)), '[]'::json) AS tags
   FROM (((public.vendor_menu_items m
     LEFT JOIN public.categories c ON ((m.category_id = c.id)))
     LEFT JOIN public.menu_item_tags mt ON ((m.id = mt.menu_item_id)))
     LEFT JOIN public.tags t ON ((mt.tag_id = t.id)))
  GROUP BY m.id, c.name;


create or replace view "public"."orders_with_scheduling" as  SELECT id,
    vendor_id,
    event_id,
    phone,
    items,
    total,
    status,
    type,
    notes,
    estimated_prep_time,
    payment_method,
    qr_code,
    qr_image,
    created_at,
    collected_at,
    prepared_at,
    ready_at,
    scheduled_pickup_time,
    actual_prep_time,
    queue_position,
    estimated_ready_time,
        CASE
            WHEN (scheduled_pickup_time IS NOT NULL) THEN 'SCHEDULED'::text
            ELSE 'IMMEDIATE'::text
        END AS order_type_scheduling,
    (EXTRACT(epoch FROM (ready_at - prepared_at)) / (60)::numeric) AS calculated_prep_time_minutes,
    (EXTRACT(epoch FROM (collected_at - ready_at)) / (60)::numeric) AS wait_time_after_ready_minutes,
    (EXTRACT(epoch FROM (collected_at - created_at)) / (60)::numeric) AS total_order_duration_minutes,
        CASE
            WHEN ((scheduled_pickup_time IS NOT NULL) AND (collected_at IS NOT NULL)) THEN (collected_at <= scheduled_pickup_time)
            ELSE NULL::boolean
        END AS collected_on_time
   FROM public.orders o;


create or replace view "public"."upcoming_public_events" as  SELECT id,
    name,
    description,
    start_date,
    end_date,
    location,
    image_url,
    is_public,
    status,
    code,
    created_at,
    updated_at
   FROM public.events
  WHERE ((is_public = true) AND (status = 'ACTIVE'::public.event_status) AND (end_date > now()))
  ORDER BY start_date;


CREATE OR REPLACE FUNCTION public.update_categories_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_events_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_menu_items_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_order_collected_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.status = 'COLLECTED' AND OLD.status != 'COLLECTED' AND NEW.collected_at IS NULL THEN
        NEW.collected_at = NOW();
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_order_prepared_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.status = 'PREPARING' AND OLD.status != 'PREPARING' AND NEW.prepared_at IS NULL THEN
        NEW.prepared_at = NOW();
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_order_ready_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.status = 'READY' AND OLD.status != 'READY' AND NEW.ready_at IS NULL THEN
        NEW.ready_at = NOW();
    END IF;
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_vendors_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_event_location()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Check that all required location fields exist
    IF NOT (
        NEW.location ? 'latitude' AND
        NEW.location ? 'longitude' AND
        NEW.location ? 'address' AND
        NEW.location ? 'city' AND
        NEW.location ? 'state' AND
        NEW.location ? 'zipCode'
    ) THEN
        RAISE EXCEPTION 'Location must contain latitude, longitude, address, city, state, and zipCode';
    END IF;
    
    -- Validate latitude and longitude are numbers
    IF NOT (
        jsonb_typeof(NEW.location->'latitude') = 'number' AND
        jsonb_typeof(NEW.location->'longitude') = 'number'
    ) THEN
        RAISE EXCEPTION 'Latitude and longitude must be numbers';
    END IF;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_vendor_hours()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    hour_item JSONB;
BEGIN
    -- Hours should be an array
    IF jsonb_typeof(NEW.hours) != 'array' THEN
        RAISE EXCEPTION 'Hours must be a JSON array';
    END IF;
    
    -- Validate each hour entry
    FOR hour_item IN SELECT * FROM jsonb_array_elements(NEW.hours)
    LOOP
        IF NOT (
            hour_item ? 'dayOfWeek' AND
            hour_item ? 'openTime' AND
            hour_item ? 'closeTime' AND
            hour_item ? 'isClosed'
        ) THEN
            RAISE EXCEPTION 'Each hour entry must contain dayOfWeek, openTime, closeTime, and isClosed';
        END IF;
        
        IF NOT (
            jsonb_typeof(hour_item->'dayOfWeek') = 'number' AND
            jsonb_typeof(hour_item->'isClosed') = 'boolean'
        ) THEN
            RAISE EXCEPTION 'dayOfWeek must be a number and isClosed must be a boolean';
        END IF;
    END LOOP;
    
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_vendor_location()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Location is optional, only validate if provided
    IF NEW.location IS NOT NULL THEN
        -- Just ensure it's a valid JSON object, no required fields
        IF jsonb_typeof(NEW.location) != 'object' THEN
            RAISE EXCEPTION 'Location must be a JSON object';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$
;

create or replace view "public"."vendors_with_details" as  SELECT v.id,
    v.name,
    v.description,
    v.email,
    v.phone,
    v.logo_url,
    v.created_at,
    v.updated_at,
    v.category_id,
    v.image_url,
    v.cuisine_type,
    v.rating,
    v.total_reviews,
    v.location,
    v.hours,
    v.is_active,
    v.is_paused,
    v.minimum_order,
    v.delivery_fee,
    v.estimated_prep_time,
    v.payment_methods,
    c.name AS category_name,
    count(m.id) AS menu_item_count
   FROM ((public.vendors v
     LEFT JOIN public.categories c ON ((v.category_id = c.id)))
     LEFT JOIN public.vendor_menu_items m ON ((v.id = m.vendor_id)))
  GROUP BY v.id, c.name;


grant delete on table "public"."categories" to "anon";

grant insert on table "public"."categories" to "anon";

grant references on table "public"."categories" to "anon";

grant select on table "public"."categories" to "anon";

grant trigger on table "public"."categories" to "anon";

grant truncate on table "public"."categories" to "anon";

grant update on table "public"."categories" to "anon";

grant delete on table "public"."categories" to "authenticated";

grant insert on table "public"."categories" to "authenticated";

grant references on table "public"."categories" to "authenticated";

grant select on table "public"."categories" to "authenticated";

grant trigger on table "public"."categories" to "authenticated";

grant truncate on table "public"."categories" to "authenticated";

grant update on table "public"."categories" to "authenticated";

grant delete on table "public"."categories" to "service_role";

grant insert on table "public"."categories" to "service_role";

grant references on table "public"."categories" to "service_role";

grant select on table "public"."categories" to "service_role";

grant trigger on table "public"."categories" to "service_role";

grant truncate on table "public"."categories" to "service_role";

grant update on table "public"."categories" to "service_role";

grant delete on table "public"."default_menu_items" to "anon";

grant insert on table "public"."default_menu_items" to "anon";

grant references on table "public"."default_menu_items" to "anon";

grant select on table "public"."default_menu_items" to "anon";

grant trigger on table "public"."default_menu_items" to "anon";

grant truncate on table "public"."default_menu_items" to "anon";

grant update on table "public"."default_menu_items" to "anon";

grant delete on table "public"."default_menu_items" to "authenticated";

grant insert on table "public"."default_menu_items" to "authenticated";

grant references on table "public"."default_menu_items" to "authenticated";

grant select on table "public"."default_menu_items" to "authenticated";

grant trigger on table "public"."default_menu_items" to "authenticated";

grant truncate on table "public"."default_menu_items" to "authenticated";

grant update on table "public"."default_menu_items" to "authenticated";

grant delete on table "public"."default_menu_items" to "service_role";

grant insert on table "public"."default_menu_items" to "service_role";

grant references on table "public"."default_menu_items" to "service_role";

grant select on table "public"."default_menu_items" to "service_role";

grant trigger on table "public"."default_menu_items" to "service_role";

grant truncate on table "public"."default_menu_items" to "service_role";

grant update on table "public"."default_menu_items" to "service_role";

grant delete on table "public"."discounts" to "anon";

grant insert on table "public"."discounts" to "anon";

grant references on table "public"."discounts" to "anon";

grant select on table "public"."discounts" to "anon";

grant trigger on table "public"."discounts" to "anon";

grant truncate on table "public"."discounts" to "anon";

grant update on table "public"."discounts" to "anon";

grant delete on table "public"."discounts" to "authenticated";

grant insert on table "public"."discounts" to "authenticated";

grant references on table "public"."discounts" to "authenticated";

grant select on table "public"."discounts" to "authenticated";

grant trigger on table "public"."discounts" to "authenticated";

grant truncate on table "public"."discounts" to "authenticated";

grant update on table "public"."discounts" to "authenticated";

grant delete on table "public"."discounts" to "service_role";

grant insert on table "public"."discounts" to "service_role";

grant references on table "public"."discounts" to "service_role";

grant select on table "public"."discounts" to "service_role";

grant trigger on table "public"."discounts" to "service_role";

grant truncate on table "public"."discounts" to "service_role";

grant update on table "public"."discounts" to "service_role";

grant delete on table "public"."event_day_hours" to "anon";

grant insert on table "public"."event_day_hours" to "anon";

grant references on table "public"."event_day_hours" to "anon";

grant select on table "public"."event_day_hours" to "anon";

grant trigger on table "public"."event_day_hours" to "anon";

grant truncate on table "public"."event_day_hours" to "anon";

grant update on table "public"."event_day_hours" to "anon";

grant delete on table "public"."event_day_hours" to "authenticated";

grant insert on table "public"."event_day_hours" to "authenticated";

grant references on table "public"."event_day_hours" to "authenticated";

grant select on table "public"."event_day_hours" to "authenticated";

grant trigger on table "public"."event_day_hours" to "authenticated";

grant truncate on table "public"."event_day_hours" to "authenticated";

grant update on table "public"."event_day_hours" to "authenticated";

grant delete on table "public"."event_day_hours" to "service_role";

grant insert on table "public"."event_day_hours" to "service_role";

grant references on table "public"."event_day_hours" to "service_role";

grant select on table "public"."event_day_hours" to "service_role";

grant trigger on table "public"."event_day_hours" to "service_role";

grant truncate on table "public"."event_day_hours" to "service_role";

grant update on table "public"."event_day_hours" to "service_role";

grant delete on table "public"."event_menu_configurations" to "anon";

grant insert on table "public"."event_menu_configurations" to "anon";

grant references on table "public"."event_menu_configurations" to "anon";

grant select on table "public"."event_menu_configurations" to "anon";

grant trigger on table "public"."event_menu_configurations" to "anon";

grant truncate on table "public"."event_menu_configurations" to "anon";

grant update on table "public"."event_menu_configurations" to "anon";

grant delete on table "public"."event_menu_configurations" to "authenticated";

grant insert on table "public"."event_menu_configurations" to "authenticated";

grant references on table "public"."event_menu_configurations" to "authenticated";

grant select on table "public"."event_menu_configurations" to "authenticated";

grant trigger on table "public"."event_menu_configurations" to "authenticated";

grant truncate on table "public"."event_menu_configurations" to "authenticated";

grant update on table "public"."event_menu_configurations" to "authenticated";

grant delete on table "public"."event_menu_configurations" to "service_role";

grant insert on table "public"."event_menu_configurations" to "service_role";

grant references on table "public"."event_menu_configurations" to "service_role";

grant select on table "public"."event_menu_configurations" to "service_role";

grant trigger on table "public"."event_menu_configurations" to "service_role";

grant truncate on table "public"."event_menu_configurations" to "service_role";

grant update on table "public"."event_menu_configurations" to "service_role";

grant delete on table "public"."event_menu_items" to "anon";

grant insert on table "public"."event_menu_items" to "anon";

grant references on table "public"."event_menu_items" to "anon";

grant select on table "public"."event_menu_items" to "anon";

grant trigger on table "public"."event_menu_items" to "anon";

grant truncate on table "public"."event_menu_items" to "anon";

grant update on table "public"."event_menu_items" to "anon";

grant delete on table "public"."event_menu_items" to "authenticated";

grant insert on table "public"."event_menu_items" to "authenticated";

grant references on table "public"."event_menu_items" to "authenticated";

grant select on table "public"."event_menu_items" to "authenticated";

grant trigger on table "public"."event_menu_items" to "authenticated";

grant truncate on table "public"."event_menu_items" to "authenticated";

grant update on table "public"."event_menu_items" to "authenticated";

grant delete on table "public"."event_menu_items" to "service_role";

grant insert on table "public"."event_menu_items" to "service_role";

grant references on table "public"."event_menu_items" to "service_role";

grant select on table "public"."event_menu_items" to "service_role";

grant trigger on table "public"."event_menu_items" to "service_role";

grant truncate on table "public"."event_menu_items" to "service_role";

grant update on table "public"."event_menu_items" to "service_role";

grant delete on table "public"."event_vendors" to "anon";

grant insert on table "public"."event_vendors" to "anon";

grant references on table "public"."event_vendors" to "anon";

grant select on table "public"."event_vendors" to "anon";

grant trigger on table "public"."event_vendors" to "anon";

grant truncate on table "public"."event_vendors" to "anon";

grant update on table "public"."event_vendors" to "anon";

grant delete on table "public"."event_vendors" to "authenticated";

grant insert on table "public"."event_vendors" to "authenticated";

grant references on table "public"."event_vendors" to "authenticated";

grant select on table "public"."event_vendors" to "authenticated";

grant trigger on table "public"."event_vendors" to "authenticated";

grant truncate on table "public"."event_vendors" to "authenticated";

grant update on table "public"."event_vendors" to "authenticated";

grant delete on table "public"."event_vendors" to "service_role";

grant insert on table "public"."event_vendors" to "service_role";

grant references on table "public"."event_vendors" to "service_role";

grant select on table "public"."event_vendors" to "service_role";

grant trigger on table "public"."event_vendors" to "service_role";

grant truncate on table "public"."event_vendors" to "service_role";

grant update on table "public"."event_vendors" to "service_role";

grant delete on table "public"."events" to "anon";

grant insert on table "public"."events" to "anon";

grant references on table "public"."events" to "anon";

grant select on table "public"."events" to "anon";

grant trigger on table "public"."events" to "anon";

grant truncate on table "public"."events" to "anon";

grant update on table "public"."events" to "anon";

grant delete on table "public"."events" to "authenticated";

grant insert on table "public"."events" to "authenticated";

grant references on table "public"."events" to "authenticated";

grant select on table "public"."events" to "authenticated";

grant trigger on table "public"."events" to "authenticated";

grant truncate on table "public"."events" to "authenticated";

grant update on table "public"."events" to "authenticated";

grant delete on table "public"."events" to "service_role";

grant insert on table "public"."events" to "service_role";

grant references on table "public"."events" to "service_role";

grant select on table "public"."events" to "service_role";

grant trigger on table "public"."events" to "service_role";

grant truncate on table "public"."events" to "service_role";

grant update on table "public"."events" to "service_role";

grant delete on table "public"."menu_categories" to "anon";

grant insert on table "public"."menu_categories" to "anon";

grant references on table "public"."menu_categories" to "anon";

grant select on table "public"."menu_categories" to "anon";

grant trigger on table "public"."menu_categories" to "anon";

grant truncate on table "public"."menu_categories" to "anon";

grant update on table "public"."menu_categories" to "anon";

grant delete on table "public"."menu_categories" to "authenticated";

grant insert on table "public"."menu_categories" to "authenticated";

grant references on table "public"."menu_categories" to "authenticated";

grant select on table "public"."menu_categories" to "authenticated";

grant trigger on table "public"."menu_categories" to "authenticated";

grant truncate on table "public"."menu_categories" to "authenticated";

grant update on table "public"."menu_categories" to "authenticated";

grant delete on table "public"."menu_categories" to "service_role";

grant insert on table "public"."menu_categories" to "service_role";

grant references on table "public"."menu_categories" to "service_role";

grant select on table "public"."menu_categories" to "service_role";

grant trigger on table "public"."menu_categories" to "service_role";

grant truncate on table "public"."menu_categories" to "service_role";

grant update on table "public"."menu_categories" to "service_role";

grant delete on table "public"."menu_item_analytics" to "anon";

grant insert on table "public"."menu_item_analytics" to "anon";

grant references on table "public"."menu_item_analytics" to "anon";

grant select on table "public"."menu_item_analytics" to "anon";

grant trigger on table "public"."menu_item_analytics" to "anon";

grant truncate on table "public"."menu_item_analytics" to "anon";

grant update on table "public"."menu_item_analytics" to "anon";

grant delete on table "public"."menu_item_analytics" to "authenticated";

grant insert on table "public"."menu_item_analytics" to "authenticated";

grant references on table "public"."menu_item_analytics" to "authenticated";

grant select on table "public"."menu_item_analytics" to "authenticated";

grant trigger on table "public"."menu_item_analytics" to "authenticated";

grant truncate on table "public"."menu_item_analytics" to "authenticated";

grant update on table "public"."menu_item_analytics" to "authenticated";

grant delete on table "public"."menu_item_analytics" to "service_role";

grant insert on table "public"."menu_item_analytics" to "service_role";

grant references on table "public"."menu_item_analytics" to "service_role";

grant select on table "public"."menu_item_analytics" to "service_role";

grant trigger on table "public"."menu_item_analytics" to "service_role";

grant truncate on table "public"."menu_item_analytics" to "service_role";

grant update on table "public"."menu_item_analytics" to "service_role";

grant delete on table "public"."menu_item_tags" to "anon";

grant insert on table "public"."menu_item_tags" to "anon";

grant references on table "public"."menu_item_tags" to "anon";

grant select on table "public"."menu_item_tags" to "anon";

grant trigger on table "public"."menu_item_tags" to "anon";

grant truncate on table "public"."menu_item_tags" to "anon";

grant update on table "public"."menu_item_tags" to "anon";

grant delete on table "public"."menu_item_tags" to "authenticated";

grant insert on table "public"."menu_item_tags" to "authenticated";

grant references on table "public"."menu_item_tags" to "authenticated";

grant select on table "public"."menu_item_tags" to "authenticated";

grant trigger on table "public"."menu_item_tags" to "authenticated";

grant truncate on table "public"."menu_item_tags" to "authenticated";

grant update on table "public"."menu_item_tags" to "authenticated";

grant delete on table "public"."menu_item_tags" to "service_role";

grant insert on table "public"."menu_item_tags" to "service_role";

grant references on table "public"."menu_item_tags" to "service_role";

grant select on table "public"."menu_item_tags" to "service_role";

grant trigger on table "public"."menu_item_tags" to "service_role";

grant truncate on table "public"."menu_item_tags" to "service_role";

grant update on table "public"."menu_item_tags" to "service_role";

grant delete on table "public"."menu_tags" to "anon";

grant insert on table "public"."menu_tags" to "anon";

grant references on table "public"."menu_tags" to "anon";

grant select on table "public"."menu_tags" to "anon";

grant trigger on table "public"."menu_tags" to "anon";

grant truncate on table "public"."menu_tags" to "anon";

grant update on table "public"."menu_tags" to "anon";

grant delete on table "public"."menu_tags" to "authenticated";

grant insert on table "public"."menu_tags" to "authenticated";

grant references on table "public"."menu_tags" to "authenticated";

grant select on table "public"."menu_tags" to "authenticated";

grant trigger on table "public"."menu_tags" to "authenticated";

grant truncate on table "public"."menu_tags" to "authenticated";

grant update on table "public"."menu_tags" to "authenticated";

grant delete on table "public"."menu_tags" to "service_role";

grant insert on table "public"."menu_tags" to "service_role";

grant references on table "public"."menu_tags" to "service_role";

grant select on table "public"."menu_tags" to "service_role";

grant trigger on table "public"."menu_tags" to "service_role";

grant truncate on table "public"."menu_tags" to "service_role";

grant update on table "public"."menu_tags" to "service_role";

grant delete on table "public"."menu_templates" to "anon";

grant insert on table "public"."menu_templates" to "anon";

grant references on table "public"."menu_templates" to "anon";

grant select on table "public"."menu_templates" to "anon";

grant trigger on table "public"."menu_templates" to "anon";

grant truncate on table "public"."menu_templates" to "anon";

grant update on table "public"."menu_templates" to "anon";

grant delete on table "public"."menu_templates" to "authenticated";

grant insert on table "public"."menu_templates" to "authenticated";

grant references on table "public"."menu_templates" to "authenticated";

grant select on table "public"."menu_templates" to "authenticated";

grant trigger on table "public"."menu_templates" to "authenticated";

grant truncate on table "public"."menu_templates" to "authenticated";

grant update on table "public"."menu_templates" to "authenticated";

grant delete on table "public"."menu_templates" to "service_role";

grant insert on table "public"."menu_templates" to "service_role";

grant references on table "public"."menu_templates" to "service_role";

grant select on table "public"."menu_templates" to "service_role";

grant trigger on table "public"."menu_templates" to "service_role";

grant truncate on table "public"."menu_templates" to "service_role";

grant update on table "public"."menu_templates" to "service_role";

grant delete on table "public"."modifier_groups" to "anon";

grant insert on table "public"."modifier_groups" to "anon";

grant references on table "public"."modifier_groups" to "anon";

grant select on table "public"."modifier_groups" to "anon";

grant trigger on table "public"."modifier_groups" to "anon";

grant truncate on table "public"."modifier_groups" to "anon";

grant update on table "public"."modifier_groups" to "anon";

grant delete on table "public"."modifier_groups" to "authenticated";

grant insert on table "public"."modifier_groups" to "authenticated";

grant references on table "public"."modifier_groups" to "authenticated";

grant select on table "public"."modifier_groups" to "authenticated";

grant trigger on table "public"."modifier_groups" to "authenticated";

grant truncate on table "public"."modifier_groups" to "authenticated";

grant update on table "public"."modifier_groups" to "authenticated";

grant delete on table "public"."modifier_groups" to "service_role";

grant insert on table "public"."modifier_groups" to "service_role";

grant references on table "public"."modifier_groups" to "service_role";

grant select on table "public"."modifier_groups" to "service_role";

grant trigger on table "public"."modifier_groups" to "service_role";

grant truncate on table "public"."modifier_groups" to "service_role";

grant update on table "public"."modifier_groups" to "service_role";

grant delete on table "public"."modifiers" to "anon";

grant insert on table "public"."modifiers" to "anon";

grant references on table "public"."modifiers" to "anon";

grant select on table "public"."modifiers" to "anon";

grant trigger on table "public"."modifiers" to "anon";

grant truncate on table "public"."modifiers" to "anon";

grant update on table "public"."modifiers" to "anon";

grant delete on table "public"."modifiers" to "authenticated";

grant insert on table "public"."modifiers" to "authenticated";

grant references on table "public"."modifiers" to "authenticated";

grant select on table "public"."modifiers" to "authenticated";

grant trigger on table "public"."modifiers" to "authenticated";

grant truncate on table "public"."modifiers" to "authenticated";

grant update on table "public"."modifiers" to "authenticated";

grant delete on table "public"."modifiers" to "service_role";

grant insert on table "public"."modifiers" to "service_role";

grant references on table "public"."modifiers" to "service_role";

grant select on table "public"."modifiers" to "service_role";

grant trigger on table "public"."modifiers" to "service_role";

grant truncate on table "public"."modifiers" to "service_role";

grant update on table "public"."modifiers" to "service_role";

grant delete on table "public"."orders" to "anon";

grant insert on table "public"."orders" to "anon";

grant references on table "public"."orders" to "anon";

grant select on table "public"."orders" to "anon";

grant trigger on table "public"."orders" to "anon";

grant truncate on table "public"."orders" to "anon";

grant update on table "public"."orders" to "anon";

grant delete on table "public"."orders" to "authenticated";

grant insert on table "public"."orders" to "authenticated";

grant references on table "public"."orders" to "authenticated";

grant select on table "public"."orders" to "authenticated";

grant trigger on table "public"."orders" to "authenticated";

grant truncate on table "public"."orders" to "authenticated";

grant update on table "public"."orders" to "authenticated";

grant delete on table "public"."orders" to "service_role";

grant insert on table "public"."orders" to "service_role";

grant references on table "public"."orders" to "service_role";

grant select on table "public"."orders" to "service_role";

grant trigger on table "public"."orders" to "service_role";

grant truncate on table "public"."orders" to "service_role";

grant update on table "public"."orders" to "service_role";

grant delete on table "public"."organizer_invites" to "anon";

grant insert on table "public"."organizer_invites" to "anon";

grant references on table "public"."organizer_invites" to "anon";

grant select on table "public"."organizer_invites" to "anon";

grant trigger on table "public"."organizer_invites" to "anon";

grant truncate on table "public"."organizer_invites" to "anon";

grant update on table "public"."organizer_invites" to "anon";

grant delete on table "public"."organizer_invites" to "authenticated";

grant insert on table "public"."organizer_invites" to "authenticated";

grant references on table "public"."organizer_invites" to "authenticated";

grant select on table "public"."organizer_invites" to "authenticated";

grant trigger on table "public"."organizer_invites" to "authenticated";

grant truncate on table "public"."organizer_invites" to "authenticated";

grant update on table "public"."organizer_invites" to "authenticated";

grant delete on table "public"."organizer_invites" to "service_role";

grant insert on table "public"."organizer_invites" to "service_role";

grant references on table "public"."organizer_invites" to "service_role";

grant select on table "public"."organizer_invites" to "service_role";

grant trigger on table "public"."organizer_invites" to "service_role";

grant truncate on table "public"."organizer_invites" to "service_role";

grant update on table "public"."organizer_invites" to "service_role";

grant delete on table "public"."organizer_password_resets" to "anon";

grant insert on table "public"."organizer_password_resets" to "anon";

grant references on table "public"."organizer_password_resets" to "anon";

grant select on table "public"."organizer_password_resets" to "anon";

grant trigger on table "public"."organizer_password_resets" to "anon";

grant truncate on table "public"."organizer_password_resets" to "anon";

grant update on table "public"."organizer_password_resets" to "anon";

grant delete on table "public"."organizer_password_resets" to "authenticated";

grant insert on table "public"."organizer_password_resets" to "authenticated";

grant references on table "public"."organizer_password_resets" to "authenticated";

grant select on table "public"."organizer_password_resets" to "authenticated";

grant trigger on table "public"."organizer_password_resets" to "authenticated";

grant truncate on table "public"."organizer_password_resets" to "authenticated";

grant update on table "public"."organizer_password_resets" to "authenticated";

grant delete on table "public"."organizer_password_resets" to "service_role";

grant insert on table "public"."organizer_password_resets" to "service_role";

grant references on table "public"."organizer_password_resets" to "service_role";

grant select on table "public"."organizer_password_resets" to "service_role";

grant trigger on table "public"."organizer_password_resets" to "service_role";

grant truncate on table "public"."organizer_password_resets" to "service_role";

grant update on table "public"."organizer_password_resets" to "service_role";

grant delete on table "public"."organizer_users" to "anon";

grant insert on table "public"."organizer_users" to "anon";

grant references on table "public"."organizer_users" to "anon";

grant select on table "public"."organizer_users" to "anon";

grant trigger on table "public"."organizer_users" to "anon";

grant truncate on table "public"."organizer_users" to "anon";

grant update on table "public"."organizer_users" to "anon";

grant delete on table "public"."organizer_users" to "authenticated";

grant insert on table "public"."organizer_users" to "authenticated";

grant references on table "public"."organizer_users" to "authenticated";

grant select on table "public"."organizer_users" to "authenticated";

grant trigger on table "public"."organizer_users" to "authenticated";

grant truncate on table "public"."organizer_users" to "authenticated";

grant update on table "public"."organizer_users" to "authenticated";

grant delete on table "public"."organizer_users" to "service_role";

grant insert on table "public"."organizer_users" to "service_role";

grant references on table "public"."organizer_users" to "service_role";

grant select on table "public"."organizer_users" to "service_role";

grant trigger on table "public"."organizer_users" to "service_role";

grant truncate on table "public"."organizer_users" to "service_role";

grant update on table "public"."organizer_users" to "service_role";

grant delete on table "public"."tags" to "anon";

grant insert on table "public"."tags" to "anon";

grant references on table "public"."tags" to "anon";

grant select on table "public"."tags" to "anon";

grant trigger on table "public"."tags" to "anon";

grant truncate on table "public"."tags" to "anon";

grant update on table "public"."tags" to "anon";

grant delete on table "public"."tags" to "authenticated";

grant insert on table "public"."tags" to "authenticated";

grant references on table "public"."tags" to "authenticated";

grant select on table "public"."tags" to "authenticated";

grant trigger on table "public"."tags" to "authenticated";

grant truncate on table "public"."tags" to "authenticated";

grant update on table "public"."tags" to "authenticated";

grant delete on table "public"."tags" to "service_role";

grant insert on table "public"."tags" to "service_role";

grant references on table "public"."tags" to "service_role";

grant select on table "public"."tags" to "service_role";

grant trigger on table "public"."tags" to "service_role";

grant truncate on table "public"."tags" to "service_role";

grant update on table "public"."tags" to "service_role";

grant delete on table "public"."vendor_event_hours" to "anon";

grant insert on table "public"."vendor_event_hours" to "anon";

grant references on table "public"."vendor_event_hours" to "anon";

grant select on table "public"."vendor_event_hours" to "anon";

grant trigger on table "public"."vendor_event_hours" to "anon";

grant truncate on table "public"."vendor_event_hours" to "anon";

grant update on table "public"."vendor_event_hours" to "anon";

grant delete on table "public"."vendor_event_hours" to "authenticated";

grant insert on table "public"."vendor_event_hours" to "authenticated";

grant references on table "public"."vendor_event_hours" to "authenticated";

grant select on table "public"."vendor_event_hours" to "authenticated";

grant trigger on table "public"."vendor_event_hours" to "authenticated";

grant truncate on table "public"."vendor_event_hours" to "authenticated";

grant update on table "public"."vendor_event_hours" to "authenticated";

grant delete on table "public"."vendor_event_hours" to "service_role";

grant insert on table "public"."vendor_event_hours" to "service_role";

grant references on table "public"."vendor_event_hours" to "service_role";

grant select on table "public"."vendor_event_hours" to "service_role";

grant trigger on table "public"."vendor_event_hours" to "service_role";

grant truncate on table "public"."vendor_event_hours" to "service_role";

grant update on table "public"."vendor_event_hours" to "service_role";

grant delete on table "public"."vendor_invites" to "anon";

grant insert on table "public"."vendor_invites" to "anon";

grant references on table "public"."vendor_invites" to "anon";

grant select on table "public"."vendor_invites" to "anon";

grant trigger on table "public"."vendor_invites" to "anon";

grant truncate on table "public"."vendor_invites" to "anon";

grant update on table "public"."vendor_invites" to "anon";

grant delete on table "public"."vendor_invites" to "authenticated";

grant insert on table "public"."vendor_invites" to "authenticated";

grant references on table "public"."vendor_invites" to "authenticated";

grant select on table "public"."vendor_invites" to "authenticated";

grant trigger on table "public"."vendor_invites" to "authenticated";

grant truncate on table "public"."vendor_invites" to "authenticated";

grant update on table "public"."vendor_invites" to "authenticated";

grant delete on table "public"."vendor_invites" to "service_role";

grant insert on table "public"."vendor_invites" to "service_role";

grant references on table "public"."vendor_invites" to "service_role";

grant select on table "public"."vendor_invites" to "service_role";

grant trigger on table "public"."vendor_invites" to "service_role";

grant truncate on table "public"."vendor_invites" to "service_role";

grant update on table "public"."vendor_invites" to "service_role";

grant delete on table "public"."vendor_menu_items" to "anon";

grant insert on table "public"."vendor_menu_items" to "anon";

grant references on table "public"."vendor_menu_items" to "anon";

grant select on table "public"."vendor_menu_items" to "anon";

grant trigger on table "public"."vendor_menu_items" to "anon";

grant truncate on table "public"."vendor_menu_items" to "anon";

grant update on table "public"."vendor_menu_items" to "anon";

grant delete on table "public"."vendor_menu_items" to "authenticated";

grant insert on table "public"."vendor_menu_items" to "authenticated";

grant references on table "public"."vendor_menu_items" to "authenticated";

grant select on table "public"."vendor_menu_items" to "authenticated";

grant trigger on table "public"."vendor_menu_items" to "authenticated";

grant truncate on table "public"."vendor_menu_items" to "authenticated";

grant update on table "public"."vendor_menu_items" to "authenticated";

grant delete on table "public"."vendor_menu_items" to "service_role";

grant insert on table "public"."vendor_menu_items" to "service_role";

grant references on table "public"."vendor_menu_items" to "service_role";

grant select on table "public"."vendor_menu_items" to "service_role";

grant trigger on table "public"."vendor_menu_items" to "service_role";

grant truncate on table "public"."vendor_menu_items" to "service_role";

grant update on table "public"."vendor_menu_items" to "service_role";

grant delete on table "public"."vendor_password_resets" to "anon";

grant insert on table "public"."vendor_password_resets" to "anon";

grant references on table "public"."vendor_password_resets" to "anon";

grant select on table "public"."vendor_password_resets" to "anon";

grant trigger on table "public"."vendor_password_resets" to "anon";

grant truncate on table "public"."vendor_password_resets" to "anon";

grant update on table "public"."vendor_password_resets" to "anon";

grant delete on table "public"."vendor_password_resets" to "authenticated";

grant insert on table "public"."vendor_password_resets" to "authenticated";

grant references on table "public"."vendor_password_resets" to "authenticated";

grant select on table "public"."vendor_password_resets" to "authenticated";

grant trigger on table "public"."vendor_password_resets" to "authenticated";

grant truncate on table "public"."vendor_password_resets" to "authenticated";

grant update on table "public"."vendor_password_resets" to "authenticated";

grant delete on table "public"."vendor_password_resets" to "service_role";

grant insert on table "public"."vendor_password_resets" to "service_role";

grant references on table "public"."vendor_password_resets" to "service_role";

grant select on table "public"."vendor_password_resets" to "service_role";

grant trigger on table "public"."vendor_password_resets" to "service_role";

grant truncate on table "public"."vendor_password_resets" to "service_role";

grant update on table "public"."vendor_password_resets" to "service_role";

grant delete on table "public"."vendor_users" to "anon";

grant insert on table "public"."vendor_users" to "anon";

grant references on table "public"."vendor_users" to "anon";

grant select on table "public"."vendor_users" to "anon";

grant trigger on table "public"."vendor_users" to "anon";

grant truncate on table "public"."vendor_users" to "anon";

grant update on table "public"."vendor_users" to "anon";

grant delete on table "public"."vendor_users" to "authenticated";

grant insert on table "public"."vendor_users" to "authenticated";

grant references on table "public"."vendor_users" to "authenticated";

grant select on table "public"."vendor_users" to "authenticated";

grant trigger on table "public"."vendor_users" to "authenticated";

grant truncate on table "public"."vendor_users" to "authenticated";

grant update on table "public"."vendor_users" to "authenticated";

grant delete on table "public"."vendor_users" to "service_role";

grant insert on table "public"."vendor_users" to "service_role";

grant references on table "public"."vendor_users" to "service_role";

grant select on table "public"."vendor_users" to "service_role";

grant trigger on table "public"."vendor_users" to "service_role";

grant truncate on table "public"."vendor_users" to "service_role";

grant update on table "public"."vendor_users" to "service_role";

grant delete on table "public"."vendors" to "anon";

grant insert on table "public"."vendors" to "anon";

grant references on table "public"."vendors" to "anon";

grant select on table "public"."vendors" to "anon";

grant trigger on table "public"."vendors" to "anon";

grant truncate on table "public"."vendors" to "anon";

grant update on table "public"."vendors" to "anon";

grant delete on table "public"."vendors" to "authenticated";

grant insert on table "public"."vendors" to "authenticated";

grant references on table "public"."vendors" to "authenticated";

grant select on table "public"."vendors" to "authenticated";

grant trigger on table "public"."vendors" to "authenticated";

grant truncate on table "public"."vendors" to "authenticated";

grant update on table "public"."vendors" to "authenticated";

grant delete on table "public"."vendors" to "service_role";

grant insert on table "public"."vendors" to "service_role";

grant references on table "public"."vendors" to "service_role";

grant select on table "public"."vendors" to "service_role";

grant trigger on table "public"."vendors" to "service_role";

grant truncate on table "public"."vendors" to "service_role";

grant update on table "public"."vendors" to "service_role";


  create policy "Menu items are viewable by everyone"
  on "public"."default_menu_items"
  as permissive
  for select
  to public
using ((is_active = true));



  create policy "Event configs are viewable by everyone"
  on "public"."event_menu_configurations"
  as permissive
  for select
  to public
using (true);



  create policy "Event menu items are viewable when included"
  on "public"."event_menu_items"
  as permissive
  for select
  to public
using ((is_included = true));



  create policy "Categories are viewable by everyone"
  on "public"."menu_categories"
  as permissive
  for select
  to public
using (true);



  create policy "Tags are viewable by everyone"
  on "public"."menu_tags"
  as permissive
  for select
  to public
using (true);


CREATE TRIGGER trigger_update_categories_timestamp BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_categories_updated_at();

CREATE TRIGGER update_default_menu_items_updated_at BEFORE UPDATE ON public.default_menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_event_menu_configs_updated_at BEFORE UPDATE ON public.event_menu_configurations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_event_menu_items_updated_at BEFORE UPDATE ON public.event_menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_events_timestamp BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_events_updated_at();

CREATE TRIGGER trigger_validate_location BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.validate_event_location();

CREATE TRIGGER update_menu_categories_updated_at BEFORE UPDATE ON public.menu_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_menu_tags_updated_at BEFORE UPDATE ON public.menu_tags FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_menu_templates_updated_at BEFORE UPDATE ON public.menu_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_modifier_groups_updated_at BEFORE UPDATE ON public.modifier_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_modifiers_updated_at BEFORE UPDATE ON public.modifiers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trigger_update_collected_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_order_collected_at();

CREATE TRIGGER trigger_update_prepared_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_order_prepared_at();

CREATE TRIGGER trigger_update_ready_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_order_ready_at();

CREATE TRIGGER trigger_update_menu_items_timestamp BEFORE UPDATE ON public.vendor_menu_items FOR EACH ROW EXECUTE FUNCTION public.update_menu_items_updated_at();

CREATE TRIGGER trigger_update_vendors_timestamp BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_vendors_updated_at();

CREATE TRIGGER trigger_validate_vendor_hours BEFORE INSERT OR UPDATE ON public.vendors FOR EACH ROW WHEN ((new.hours IS NOT NULL)) EXECUTE FUNCTION public.validate_vendor_hours();

CREATE TRIGGER trigger_validate_vendor_location BEFORE INSERT OR UPDATE ON public.vendors FOR EACH ROW WHEN ((new.location IS NOT NULL)) EXECUTE FUNCTION public.validate_vendor_location();


  create policy "Allow public reads 1kwnrja_0"
  on "storage"."objects"
  as permissive
  for select
  to anon, authenticated
using ((bucket_id = 'order-qrcodes'::text));



  create policy "Allow public uploads 1kwnrja_0"
  on "storage"."objects"
  as permissive
  for insert
  to anon, authenticated
with check ((bucket_id = 'order-qrcodes'::text));



