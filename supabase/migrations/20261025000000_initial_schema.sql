-- 001_initial_schema.sql
-- TechPulse BD Schema: Products, Price History, Comments, Outbound Clicks & Batch Upsert RPC

-- 1. Products Table
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_name TEXT NOT NULL,
    title TEXT NOT NULL,
    product_url TEXT NOT NULL,
    image_url TEXT,
    current_price NUMERIC NOT NULL DEFAULT 0,
    stock_status TEXT NOT NULL DEFAULT 'In Stock',
    category TEXT DEFAULT 'Component',
    last_scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_vendor_product UNIQUE (vendor_name, product_url)
);

-- Full-text search index on product titles
CREATE INDEX IF NOT EXISTS idx_products_title_trgm ON public.products USING gin (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS idx_products_vendor ON public.products(vendor_name);
CREATE INDEX IF NOT EXISTS idx_products_price ON public.products(current_price);
CREATE INDEX IF NOT EXISTS idx_products_last_scraped ON public.products(last_scraped_at DESC);

-- 2. Price History Table (Only stores price points when price changes)
CREATE TABLE IF NOT EXISTS public.price_history (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    price NUMERIC NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_date ON public.price_history(product_id, recorded_at ASC);

-- 3. Comments / Reviews Table (Bangladeshi Phone Number identity)
CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    user_phone TEXT NOT NULL CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$'),
    user_name TEXT DEFAULT 'Anonymous User',
    rating INT DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
    comment_text TEXT NOT NULL,
    helpful_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_product ON public.comments(product_id, created_at DESC);

-- 4. Outbound Clicks Table (Analytics)
CREATE TABLE IF NOT EXISTS public.outbound_clicks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    vendor_name TEXT NOT NULL,
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Stored Procedure: Atomic Zero-Downtime Low-Bandwidth Batch Upsert
CREATE OR REPLACE FUNCTION public.upsert_scraped_batch(items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    item JSONB;
    v_pid UUID;
    v_old_price NUMERIC;
    processed_count INT := 0;
    price_changed_count INT := 0;
BEGIN
    FOR item IN SELECT * FROM jsonb_array_elements(items)
    LOOP
        -- Check if product exists and get its current price
        SELECT id, current_price INTO v_pid, v_old_price
        FROM public.products
        WHERE vendor_name = item->>'vendor_name'
          AND product_url = item->>'product_url';

        IF v_pid IS NULL THEN
            -- Insert new product
            INSERT INTO public.products (
                vendor_name,
                title,
                product_url,
                image_url,
                current_price,
                stock_status,
                category,
                last_scraped_at
            ) VALUES (
                item->>'vendor_name',
                item->>'title',
                item->>'product_url',
                item->>'image_url',
                COALESCE((item->>'price')::NUMERIC, 0),
                COALESCE(item->>'stock_status', 'In Stock'),
                COALESCE(item->>'category', 'Component'),
                now()
            ) RETURNING id INTO v_pid;

            -- Log initial price in history
            INSERT INTO public.price_history (product_id, price, recorded_at)
            VALUES (v_pid, COALESCE((item->>'price')::NUMERIC, 0), now());

            price_changed_count := price_changed_count + 1;
        ELSE
            -- Update existing product
            UPDATE public.products
            SET title = COALESCE(item->>'title', title),
                image_url = COALESCE(item->>'image_url', image_url),
                stock_status = COALESCE(item->>'stock_status', stock_status),
                category = COALESCE(item->>'category', category),
                current_price = COALESCE((item->>'price')::NUMERIC, current_price),
                last_scraped_at = now()
            WHERE id = v_pid;

            -- Conditional price logging: ONLY append to history if price changed
            IF (item->>'price')::NUMERIC IS DISTINCT FROM v_old_price THEN
                INSERT INTO public.price_history (product_id, price, recorded_at)
                VALUES (v_pid, (item->>'price')::NUMERIC, now());
                
                price_changed_count := price_changed_count + 1;
            END IF;
        END IF;

        processed_count := processed_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'status', 'success',
        'processed', processed_count,
        'price_updates', price_changed_count
    );
END;
$$;

-- 6. Row Level Security (RLS) Policies
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbound_clicks ENABLE ROW LEVEL SECURITY;

-- Products: Anyone can read
CREATE POLICY "Public products viewable by everyone" ON public.products
    FOR SELECT USING (true);

-- Price History: Anyone can read
CREATE POLICY "Public price history viewable by everyone" ON public.price_history
    FOR SELECT USING (true);

-- Comments: Anyone can read, anyone with a valid BD phone number can insert
CREATE POLICY "Public comments viewable by everyone" ON public.comments
    FOR SELECT USING (true);

CREATE POLICY "Anyone can add comments with valid phone" ON public.comments
    FOR INSERT WITH CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$');

-- Outbound Clicks: Anyone can log a click
CREATE POLICY "Anyone can record outbound click" ON public.outbound_clicks
    FOR INSERT WITH CHECK (true);
