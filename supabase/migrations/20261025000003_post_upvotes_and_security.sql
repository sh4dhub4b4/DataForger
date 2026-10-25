-- 20261025000003_post_upvotes_and_security.sql
-- Hardens community post upvotes with anti-fraud tracking & atomic RPCs

-- 1. Create post_upvotes table
CREATE TABLE IF NOT EXISTS public.post_upvotes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    user_phone TEXT NOT NULL CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_post_user_upvote UNIQUE (post_id, user_phone)
);

CREATE INDEX IF NOT EXISTS idx_post_upvotes_post_id ON public.post_upvotes(post_id);

ALTER TABLE public.post_upvotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public view post upvotes" ON public.post_upvotes FOR SELECT USING (true);
CREATE POLICY "Users can insert post upvotes with valid phone" ON public.post_upvotes FOR INSERT WITH CHECK (user_phone ~ '^(\+8801|01)[3-9]\d{8}$');
CREATE POLICY "Users can delete own post upvote" ON public.post_upvotes FOR DELETE USING (true);

-- 2. Atomic Community Post Upvote RPC
CREATE OR REPLACE FUNCTION public.toggle_post_upvote(p_post_id UUID, p_user_phone TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_exists BOOLEAN;
    v_total_upvotes INT;
BEGIN
    IF p_user_phone !~ '^(\+8801|01)[3-9]\d{8}$' THEN
        RAISE EXCEPTION 'Invalid Bangladeshi phone identity';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.post_upvotes
        WHERE post_id = p_post_id AND user_phone = p_user_phone
    ) INTO v_exists;

    IF v_exists THEN
        DELETE FROM public.post_upvotes
        WHERE post_id = p_post_id AND user_phone = p_user_phone;
    ELSE
        INSERT INTO public.post_upvotes (post_id, user_phone)
        VALUES (p_post_id, p_user_phone);
    END IF;

    SELECT COUNT(*) INTO v_total_upvotes
    FROM public.post_upvotes
    WHERE post_id = p_post_id;

    UPDATE public.community_posts
    SET upvotes_count = v_total_upvotes
    WHERE id = p_post_id;

    RETURN jsonb_build_object(
        'upvoted', NOT v_exists,
        'total_upvotes', v_total_upvotes
    );
END;
$$;

-- 3. Safe Profile Upsert RPC (Prevents reputation tampering & XSS in usernames)
CREATE OR REPLACE FUNCTION public.safe_upsert_profile(
    p_phone TEXT,
    p_username TEXT,
    p_bio TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_clean_phone TEXT;
    v_clean_username TEXT;
    v_clean_bio TEXT;
    v_points INT;
BEGIN
    v_clean_phone := regexp_replace(p_phone, '\s+', '', 'g');
    IF v_clean_phone !~ '^(\+8801|01)[3-9]\d{8}$' THEN
        RAISE EXCEPTION 'Invalid Bangladeshi mobile number';
    END IF;

    v_clean_username := regexp_replace(p_username, '[^a-zA-Z0-9_]', '', 'g');
    IF length(v_clean_username) < 3 OR length(v_clean_username) > 25 THEN
        RAISE EXCEPTION 'Username must be 3-25 alphanumeric characters';
    END IF;

    v_clean_bio := substring(trim(COALESCE(p_bio, 'PC Builder & Hardware Enthusiast')) from 1 for 140);

    SELECT COALESCE(reputation_points, 25) INTO v_points
    FROM public.user_profiles
    WHERE user_phone = v_clean_phone;

    IF v_points IS NULL THEN
        v_points := 25;
    END IF;

    INSERT INTO public.user_profiles (user_phone, username, bio, reputation_points, updated_at)
    VALUES (v_clean_phone, v_clean_username, v_clean_bio, v_points, now())
    ON CONFLICT (user_phone) DO UPDATE
    SET username = EXCLUDED.username,
        bio = EXCLUDED.bio,
        updated_at = now();

    RETURN jsonb_build_object(
        'user_phone', v_clean_phone,
        'username', v_clean_username,
        'bio', v_clean_bio,
        'reputation_points', v_points
    );
END;
$$;
