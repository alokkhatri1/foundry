import { useRef, useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../supabase';
import { mapFileRow, mapCoworkerRow, mapToolRow, mapWorkflowRow } from '../utils/treeUtils';

export default function useSupabase() {
  const roomIdRef = useRef(null);
  const presenceChannelRef = useRef(null);
  const realtimeChannelRef = useRef(null);

  // ===== Auth =====
  const getSession = useCallback(async () => {
    if (!isSupabaseConfigured) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }, []);

  const getUser = useCallback(async () => {
    if (!isSupabaseConfigured) return null;
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) console.error('[sb] Google sign-in:', error.message);
  }, []);

  const signInWithMagicLink = useCallback(async (email) => {
    if (!isSupabaseConfigured) return { error: { message: 'Supabase not configured' } };
    const redirectTo = window.location.origin || window.location.href.split('/').slice(0, 3).join('/');
    console.log('[sb] magic link redirect:', redirectTo);
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) console.error('[sb] Magic link:', error.message);
    return { error };
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  const checkIsAdmin = useCallback(async (userId) => {
    if (!isSupabaseConfigured || !userId) return false;
    const { data } = await supabase.from('admins').select('id').eq('id', userId).maybeSingle();
    return !!data;
  }, []);

  const onAuthStateChange = useCallback((callback) => {
    if (!isSupabaseConfigured) return () => {};
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // ===== Admin: workshop management =====
  const createWorkshop = useCallback(async (name, orgName, adminId) => {
    if (!isSupabaseConfigured) return null;
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data, error } = await supabase.from('rooms')
      .insert({ code, org_name: orgName || name, admin_id: adminId, current_stage: '1' })
      .select('id, code')
      .single();
    if (error) { console.error('[sb] createWorkshop:', error.message); return null; }
    return data;
  }, []);

  const loadAdminWorkshops = useCallback(async (adminId) => {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('rooms')
      .select('id, code, org_name, created_at, deprecated_at, current_stage, credit_allocation')
      .eq('admin_id', adminId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[sb] loadAdminWorkshops:', error.message); return []; }
    return data || [];
  }, []);

  const loadWorkshopParticipants = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase.from('participants').select('*').eq('room_id', roomId);
    return data || [];
  }, []);

  const deleteWorkshop = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return;
    // Cascade delete handled by foreign keys
    const { error } = await supabase.from('rooms').delete().eq('id', roomId);
    if (error) console.error('[sb] deleteWorkshop:', error.message);
  }, []);

  const deprecateWorkshop = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('rooms')
      .update({ deprecated_at: new Date().toISOString() })
      .eq('id', roomId);
    if (error) console.error('[sb] deprecateWorkshop:', error.message);
  }, []);

  const revealStage = useCallback(async (roomId, toStage, fromStage, actorUserId) => {
    if (!isSupabaseConfigured) return;
    await supabase.from('stage_events').insert({
      room_id: roomId,
      from_stage: fromStage || null,
      to_stage: toStage,
      actor: actorUserId || null,
    });
    const { error } = await supabase.from('rooms')
      .update({ current_stage: toStage })
      .eq('id', roomId);
    if (error) console.error('[sb] revealStage:', error.message);
    // Note: stage 3 and 4 no longer auto-create top-level Knowledge/Instructions
    // folders. Knowledge + skills live as subfolders inside each user-created
    // dept folder; the FileExplorer handles creation on new-folder click and
    // stage-gates the `skills` subfolder's visibility until stage 4.
  }, []);

  // Batch reveal for the "Reveal all" admin action. Writes one stage_events
  // row per intermediate transition (preserves the audit trail) but commits
  // rooms.current_stage in a single write so participant clients get one
  // realtime update instead of N. During the 2026-04-23 session, six
  // sequential writes fanned out to 35 clients and overwhelmed their
  // stage-advance logic — UI stopped responding.
  const revealAllStages = useCallback(async (roomId, transitions, toStage, actorUserId) => {
    if (!isSupabaseConfigured) return;
    const events = (transitions || []).map(t => ({
      room_id: roomId,
      from_stage: t.from || null,
      to_stage: t.to,
      actor: actorUserId || null,
    }));
    if (events.length > 0) {
      const { error: insertErr } = await supabase.from('stage_events').insert(events);
      if (insertErr) console.error('[sb] revealAllStages stage_events:', insertErr.message);
    }
    const { error } = await supabase.from('rooms')
      .update({ current_stage: toStage })
      .eq('id', roomId);
    if (error) console.error('[sb] revealAllStages:', error.message);
  }, []);

  const loadWorkshopStats = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return null;
    const [files, coworkers, workflows, participants, messages] = await Promise.all([
      supabase.from('files').select('id', { count: 'exact', head: true }).eq('room_id', roomId),
      supabase.from('coworkers').select('id', { count: 'exact', head: true }).eq('room_id', roomId),
      supabase.from('workflows').select('id', { count: 'exact', head: true }).eq('room_id', roomId),
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('room_id', roomId),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('room_id', roomId),
    ]);
    return {
      files: files.count || 0,
      coworkers: coworkers.count || 0,
      workflows: workflows.count || 0,
      participants: participants.count || 0,
      messages: messages.count || 0,
    };
  }, []);

  const loadWorkshopContent = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return {};
    const [files, coworkers, workflows] = await Promise.all([
      supabase.from('files').select('id, name, type, parent_id, created_by').eq('room_id', roomId),
      supabase.from('coworkers').select('id, name, role, avatar, color, created_by, created_at').eq('room_id', roomId),
      supabase.from('workflows').select('id, name, steps, created_by, created_at').eq('room_id', roomId),
    ]);
    return {
      files: files.data || [],
      coworkers: coworkers.data || [],
      workflows: workflows.data || [],
    };
  }, []);

  const loadWorkshopActivity = useCallback(async (roomId, limit = 20) => {
    if (!isSupabaseConfigured) return [];
    const { data } = await supabase.from('messages')
      .select('id, type, participant_name, content, label, created_at')
      .eq('room_id', roomId)
      .in('type', ['user', 'direct-response', 'status'])
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }, []);

  const seedWorkshopContent = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return;
    const { createStarterFolders, createStarterCoworkers, createStarterTools, createStarterWorkflow } = await import('../data/starterContent');
    const { flattenTree } = await import('../utils/treeUtils');

    const tree = createStarterFolders('Workshop Organization');
    const files = flattenTree(tree, roomId);
    const coworkers = createStarterCoworkers();
    const tools = createStarterTools();
    const workflow = createStarterWorkflow();

    // Insert files
    await supabase.from('files').upsert(
      files.map(f => ({ ...f, room_id: roomId, updated_at: new Date().toISOString() })),
      { onConflict: 'id' }
    );
    // Insert coworkers
    for (const cw of coworkers) {
      await supabase.from('coworkers').upsert({
        id: cw.id, room_id: roomId, name: cw.name, role: cw.role,
        avatar: cw.avatar, color: cw.color,
        instruction_file_ids: cw.instructionFileIds || [],
        knowledge_file_ids: cw.knowledgeFileIds || [],
        tool_ids: cw.toolIds || [],
        tool_configs: cw.toolConfigs || {},
        created_by: 'System',
      }, { onConflict: 'id' });
    }
    // Insert tools
    for (const t of tools) {
      await supabase.from('tools').upsert({
        id: t.id, room_id: roomId, name: t.name, type: t.type,
        description: t.description, icon: t.icon,
        is_builtin: t.isBuiltin || false, config: t.config,
        created_by: 'System',
      }, { onConflict: 'id' });
    }
    // Insert workflow
    await supabase.from('workflows').upsert({
      id: workflow.id, room_id: roomId, name: workflow.name,
      steps: workflow.steps, created_by: 'System',
    }, { onConflict: 'id' });
  }, []);

  const subscribeToWorkshopPresence = useCallback((roomId, onPresenceChange) => {
    if (!isSupabaseConfigured) return () => {};
    const channel = supabase.channel(`admin-presence:${roomId}`);
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const online = [];
      for (const [key, entries] of Object.entries(state)) {
        if (entries.length > 0) online.push({ name: entries[0].name || key, color: entries[0].color });
      }
      onPresenceChange(online);
    });
    channel.subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // ===== Room: create or join =====
  const joinRoom = useCallback(async (code) => {
    if (!isSupabaseConfigured) return { error: 'not_configured' };
    const { data: room, error } = await supabase
      .from('rooms')
      .select('id, org_name, deprecated_at, current_stage, credit_allocation')
      .eq('code', code)
      .maybeSingle();
    if (error) { console.error('[sb] joinRoom:', error.message); return { error: 'db_error' }; }
    if (!room) return { error: 'not_found' };
    if (room.deprecated_at) return { error: 'deprecated' };
    roomIdRef.current = room.id;
    console.log('[sb] joined room:', room.id);
    return {
      id: room.id,
      org_name: room.org_name,
      current_stage: room.current_stage,
      credit_allocation: room.credit_allocation ?? 1000,
    };
  }, []);

  // Credit allocation setter — used by the admin dashboard. Per-room, affects
  // every participant going forward. Existing participants don't lose credits
  // already spent; their budget just jumps to match the new allocation.
  const setCreditAllocation = useCallback(async (roomId, allocation) => {
    if (!isSupabaseConfigured || !roomId) return false;
    const { error } = await supabase.from('rooms')
      .update({ credit_allocation: allocation })
      .eq('id', roomId);
    if (error) { console.error('[sb] setCreditAllocation:', error.message); return false; }
    return true;
  }, []);

  const setParticipantCreditBonus = useCallback(async (participantId, bonus) => {
    if (!isSupabaseConfigured || !participantId) return false;
    const { error } = await supabase.from('participants')
      .update({ credit_bonus: bonus })
      .eq('id', participantId);
    if (error) { console.error('[sb] setParticipantCreditBonus:', error.message); return false; }
    return true;
  }, []);

  const getRoomId = useCallback(() => roomIdRef.current, []);

  // ===== Participant =====
  const upsertParticipant = useCallback(async (name, color, authUserId, email) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return null;
    const row = { room_id: roomIdRef.current, name, color, online: true, last_seen_at: new Date().toISOString() };
    if (authUserId) row.auth_user_id = authUserId;
    if (email) row.email = email;

    // Only upsert by (room_id, email) — that's the only unique constraint the
    // schema has since migration 005. Without email, skip straight to the
    // lookup+insert fallback below.
    if (email) {
      const { data, error } = await supabase.from('participants').upsert(
        row,
        { onConflict: 'room_id,email' }
      ).select('id, name, color, email').single();

      if (!error && data) return data;

      // Upsert failed — log and try to recover by fetching existing row.
      console.error('[sb] upsertParticipant upsert failed:', error?.message || 'no data');
    }

    // Recovery path: look up by email (preferred) or name within the room.
    let q = supabase.from('participants').select('id, name, color, email').eq('room_id', roomIdRef.current);
    q = email ? q.eq('email', email) : q.eq('name', name);
    const lookup = await q.maybeSingle();
    if (lookup.error) {
      console.error('[sb] upsertParticipant lookup failed:', lookup.error.message);
      return null;
    }
    if (lookup.data) return lookup.data;

    // Final fallback: plain insert without conflict handling.
    const insert = await supabase.from('participants').insert(row).select('id, name, color, email').single();
    if (insert.error) { console.error('[sb] upsertParticipant insert fallback failed:', insert.error.message); return null; }
    return insert.data;
  }, []);

  const loadParticipants = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data } = await supabase.from('participants').select('*').eq('room_id', roomIdRef.current);
    return (data || []).map(p => ({
      id: p.id, name: p.name, color: p.color, online: false,
      kind: p.kind || 'human',
      coworkerId: p.coworker_id || null,
      joinedAt: new Date(p.joined_at).getTime(), lastSeen: new Date(p.last_seen_at).getTime(),
    }));
  }, []);

  // Human-only lookup — used by send_dm (AI coworker DMing a human) and
  // ask_human (AI picking a human recipient). AI mirror participants are
  // excluded so an AI can't accidentally DM another AI via this path.
  const findParticipantIdByName = useCallback(async (name) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return null;
    const { data } = await supabase.from('participants')
      .select('id')
      .eq('room_id', roomIdRef.current)
      .eq('name', name)
      .eq('kind', 'human')
      .maybeSingle();
    return data?.id || null;
  }, []);

  // Resolve an AI coworker's mirror participant id so the coworker can act
  // as a first-class DM sender/recipient.
  const getCoworkerParticipantId = useCallback(async (coworkerId) => {
    if (!isSupabaseConfigured || !roomIdRef.current || !coworkerId) return null;
    const { data } = await supabase.from('participants')
      .select('id')
      .eq('room_id', roomIdRef.current)
      .eq('coworker_id', coworkerId)
      .maybeSingle();
    return data?.id || null;
  }, []);

  const getParticipantById = useCallback(async (id) => {
    if (!isSupabaseConfigured || !id) return null;
    const { data } = await supabase.from('participants')
      .select('id, name, color, credit_bonus')
      .eq('id', id)
      .maybeSingle();
    return data;
  }, []);

  // ===== User preferences (global per user) =====
  const loadUserPreferences = useCallback(async (authUserId) => {
    if (!isSupabaseConfigured || !authUserId) return '';
    const { data } = await supabase.from('user_preferences')
      .select('content')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    return data?.content || '';
  }, []);

  const saveUserPreferences = useCallback(async (authUserId, content) => {
    if (!isSupabaseConfigured || !authUserId) return;
    const { error } = await supabase.from('user_preferences').upsert({
      auth_user_id: authUserId,
      content,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    if (error) console.error('[sb] saveUserPreferences:', error.message);
  }, []);

  const loadUserRole = useCallback(async (authUserId) => {
    if (!isSupabaseConfigured || !authUserId) return '';
    const { data } = await supabase.from('user_preferences')
      .select('role')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    return data?.role || '';
  }, []);

  const saveUserRole = useCallback(async (authUserId, role) => {
    if (!isSupabaseConfigured || !authUserId) return;
    const { error } = await supabase.from('user_preferences').upsert({
      auth_user_id: authUserId,
      role,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'auth_user_id' });
    if (error) console.error('[sb] saveUserRole:', error.message);
  }, []);

  // ===== Direct messages =====
  const sendDm = useCallback(async (fromParticipantId, toParticipantId, content, options = {}) => {
    if (!isSupabaseConfigured || !roomIdRef.current) {
      return { error: 'supabase not configured or no room' };
    }
    if (!fromParticipantId) return { error: 'missing fromParticipantId (myParticipantId is null)' };
    if (!toParticipantId) return { error: 'missing toParticipantId' };
    const row = {
      room_id: roomIdRef.current,
      from_participant_id: fromParticipantId,
      to_participant_id: toParticipantId,
      content,
    };
    if (options.kind && options.kind !== 'chat') row.kind = options.kind;
    if (options.metadata) row.metadata = options.metadata;
    const { data, error } = await supabase.from('direct_messages').insert(row).select().single();
    if (error) {
      console.error('[sb] sendDm:', error.message, error);
      return { error: error.message, code: error.code, details: error.details, hint: error.hint };
    }
    return { data };
  }, []);

  const fetchDmThread = useCallback(async (myParticipantId, otherParticipantId) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase.from('direct_messages')
      .select('*')
      .eq('room_id', roomIdRef.current)
      .or(`and(from_participant_id.eq.${myParticipantId},to_participant_id.eq.${otherParticipantId}),and(from_participant_id.eq.${otherParticipantId},to_participant_id.eq.${myParticipantId})`)
      .order('created_at', { ascending: true });
    if (error) { console.error('[sb] fetchDmThread:', error.message); return []; }
    return data || [];
  }, []);

  const subscribeToDms = useCallback((myParticipantId, onNewMessage) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};
    // Unique suffix so multiple subscribers (App-level notifications + DM thread)
    // don't collide on the same Supabase channel name and throw on .on() after .subscribe().
    const uniq = Math.random().toString(36).slice(2, 10);
    const channel = supabase.channel(`dms:${roomIdRef.current}:${myParticipantId}:${uniq}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `room_id=eq.${roomIdRef.current}`,
      }, (payload) => {
        const dm = payload.new;
        if (dm.from_participant_id === myParticipantId || dm.to_participant_id === myParticipantId) {
          onNewMessage(dm);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Subscribe to every DM in the room, regardless of participant. Used to route
  // replies to pending ask_human calls whose resolver lives on this client (the
  // participant who initiated the AI chat).
  const subscribeToAllRoomDms = useCallback((onNewMessage) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};
    const uniq = Math.random().toString(36).slice(2, 10);
    const channel = supabase.channel(`dms-all:${roomIdRef.current}:${uniq}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `room_id=eq.${roomIdRef.current}`,
      }, (payload) => {
        onNewMessage(payload.new);
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // ===== Files (granular) =====
  const loadFiles = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase.from('files').select('*').eq('room_id', roomIdRef.current);
    if (error) { console.error('[sb] loadFiles:', error.message); return []; }
    return (data || []).map(mapFileRow);
  }, []);

  const saveFile = useCallback(async (file) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.from('files').upsert({
      id: file.id,
      room_id: roomIdRef.current,
      parent_id: file.parentId ?? file.parent_id ?? null,
      name: file.name,
      type: file.type,
      content: file.content || null,
      sort_order: file.sortOrder ?? file.sort_order ?? 0,
      created_by: file.createdBy ?? file.created_by ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) console.error('[sb] saveFile:', error.message);
  }, []);

  const deleteFile = useCallback(async (fileId) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.rpc('delete_file_tree', { p_file_id: fileId });
    if (error) console.error('[sb] deleteFile:', error.message);
  }, []);

  const saveFilesBatch = useCallback(async (files) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const rows = files.map(f => {
      const row = {
        id: f.id, room_id: f.room_id || roomIdRef.current,
        parent_id: f.parent_id || null, name: f.name, type: f.type,
        content: f.content || null, sort_order: f.sort_order ?? 0,
        updated_at: new Date().toISOString(),
      };
      // Only set created_by when we actually have a value — omitting the key
      // lets Supabase preserve any existing stamp on re-upsert (e.g. a user's
      // file getting re-written by a tree migration pass that doesn't know
      // the author).
      const createdBy = f.created_by ?? f.createdBy ?? null;
      if (createdBy) row.created_by = createdBy;
      return row;
    });
    const { error } = await supabase.from('files').upsert(rows, { onConflict: 'id' });
    if (error) console.error('[sb] saveFilesBatch:', error.message);
  }, []);

  // ===== Coworkers (granular) =====
  const loadCoworkers = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase.from('coworkers').select('*').eq('room_id', roomIdRef.current);
    if (error) { console.error('[sb] loadCoworkers:', error.message); return []; }
    return (data || []).map(mapCoworkerRow);
  }, []);

  const saveCoworker = useCallback(async (cw) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.from('coworkers').upsert({
      id: cw.id, room_id: roomIdRef.current,
      name: cw.name, role: cw.role, avatar: cw.avatar, color: cw.color,
      instruction_file_ids: cw.instructionFileIds || [],
      knowledge_file_ids: cw.knowledgeFileIds || [],
      tool_ids: cw.toolIds || [],
      tool_configs: cw.toolConfigs || {},
      created_by: cw.createdBy, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) { console.error('[sb] saveCoworker:', error.message); return; }

    // Mirror the coworker as a first-class `participants` row so it can
    // appear as a DM sender/recipient (Stage 5c Collaboration).
    const { data: existing } = await supabase.from('participants')
      .select('id')
      .eq('room_id', roomIdRef.current)
      .eq('coworker_id', cw.id)
      .maybeSingle();
    if (existing?.id) {
      await supabase.from('participants').update({
        name: cw.name,
        color: cw.color,
        last_seen_at: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('participants').insert({
        room_id: roomIdRef.current,
        kind: 'ai',
        coworker_id: cw.id,
        name: cw.name,
        color: cw.color,
        online: true,
      });
    }
  }, []);

  const deleteCoworker = useCallback(async (id) => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('coworkers').delete().eq('id', id);
    if (error) console.error('[sb] deleteCoworker:', error.message);
  }, []);

  // ===== Tools (granular) =====
  const loadTools = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase.from('tools').select('*').eq('room_id', roomIdRef.current);
    if (error) { console.error('[sb] loadTools:', error.message); return []; }
    return (data || []).map(mapToolRow);
  }, []);

  const saveTool = useCallback(async (tool) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.from('tools').upsert({
      id: tool.id, room_id: roomIdRef.current,
      name: tool.name, type: tool.type, description: tool.description,
      icon: tool.icon, is_builtin: tool.isBuiltin || false,
      config: tool.config, created_by: tool.createdBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) console.error('[sb] saveTool:', error.message);
  }, []);

  const deleteTool = useCallback(async (id) => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('tools').delete().eq('id', id);
    if (error) console.error('[sb] deleteTool:', error.message);
  }, []);

  // ===== Workflows (granular) =====
  const loadWorkflows = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase.from('workflows').select('*').eq('room_id', roomIdRef.current);
    if (error) { console.error('[sb] loadWorkflows:', error.message); return []; }
    return (data || []).map(mapWorkflowRow);
  }, []);

  const saveWorkflow = useCallback(async (wf) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.from('workflows').upsert({
      id: wf.id, room_id: roomIdRef.current,
      name: wf.name, steps: wf.steps || [],
      nodes: wf.nodes || null,
      edges: wf.edges || null,
      created_by: wf.createdBy, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) console.error('[sb] saveWorkflow:', error.message);
  }, []);

  const deleteWorkflow = useCallback(async (id) => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.from('workflows').delete().eq('id', id);
    if (error) console.error('[sb] deleteWorkflow:', error.message);
  }, []);

  // ===== Messages =====
  const saveMessage = useCallback(async (msg, conversationId) => {
    if (!isSupabaseConfigured || !roomIdRef.current || msg.type === 'loading') return;
    await supabase.from('messages').insert({
      room_id: roomIdRef.current, conversation_id: conversationId || null,
      type: msg.type, participant_name: msg.participantName || null,
      content: msg.content || null, label: msg.label || null,
      coworker_avatar: msg.coworkerAvatar || null,
      tool_name: msg.toolName || null, tool_icon: msg.toolIcon || null,
      tool_type: msg.toolType || null, tool_inputs: msg.inputs || null,
      tool_outputs: msg.outputs || null,
      payload: msg.attachments ? { attachments: msg.attachments } : null,
    });
  }, []);

  // ===== Workflow runs =====
  const saveWorkflowRun = useCallback(async (run) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('workflow_runs').upsert({
      id: run.id, room_id: roomIdRef.current,
      workflow_id: run.workflowId, workflow_name: run.workflowName,
      status: run.status, current_step_index: run.currentStepIndex,
      started_by: run.startedBy, case_input: run.caseInput,
      step_results: run.stepResults,
      started_at: run.startedAt ? new Date(run.startedAt).toISOString() : new Date().toISOString(),
      completed_at: run.completedAt ? new Date(run.completedAt).toISOString() : null,
    }, { onConflict: 'id' });
  }, []);

  // Reverse-map a workflow_runs row back to the shape the runtime expects.
  function mapWorkflowRunRow(row) {
    return {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      status: row.status,
      currentStepIndex: row.current_step_index,
      startedBy: row.started_by,
      caseInput: row.case_input,
      stepResults: row.step_results || [],
      startedAt: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
      completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
    };
  }

  // Load every workflow run in the current room so all participants see
  // everyone's runs (Stage 7 observability). Capped at 100 most-recent to
  // keep the initial payload small; older runs can be fetched on demand.
  const loadWorkflowRuns = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase
      .from('workflow_runs')
      .select('*')
      .eq('room_id', roomIdRef.current)
      .order('started_at', { ascending: false })
      .limit(100);
    if (error) { console.error('[sb] loadWorkflowRuns:', error.message); return []; }
    return (data || []).map(mapWorkflowRunRow);
  }, []);

  // Decision log for a specific run: every Approve/Reject with who, when,
  // and what comment they left. Loaded on demand when the user expands
  // a review step in the Observability RunDetail view.
  const loadApprovals = useCallback(async (runId) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase
      .from('approvals')
      .select('*')
      .eq('room_id', roomIdRef.current)
      .eq('run_id', runId)
      .order('resolved_at', { ascending: true });
    if (error) { console.error('[sb] loadApprovals:', error.message); return []; }
    return data || [];
  }, []);

  // Load every approval across the room. Used by the graduation scorecard
  // to compute reviews-resolved counts per participant without having to
  // open each run's detail view first.
  const loadAllRoomApprovals = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase
      .from('approvals')
      .select('*')
      .eq('room_id', roomIdRef.current)
      .order('resolved_at', { ascending: true });
    if (error) { console.error('[sb] loadAllRoomApprovals:', error.message); return []; }
    return data || [];
  }, []);

  const logToolCall = useCallback(async (data) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('tool_calls').insert({
      room_id: roomIdRef.current, run_id: data.runId || null,
      coworker_id: data.coworkerId || null, coworker_name: data.coworkerName || null,
      tool_name: data.toolName, tool_type: data.toolType || null,
      inputs: data.inputs || null, outputs: data.outputs || null,
      success: data.outputs?.success ?? true,
    });
  }, []);

  const logApproval = useCallback(async (data) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('approvals').insert({
      room_id: roomIdRef.current, run_id: data.runId || null,
      step_id: data.stepId || null, step_name: data.stepName || null,
      prompt: data.prompt || null, assignee_name: data.assigneeName || null,
      resolved_by: data.resolvedBy || null, action: data.action,
      comment: data.comment || null, resolved_at: new Date().toISOString(),
    });
  }, []);

  // LLM usage — one row per Claude API response, precomputed cost. Non-blocking
  // fire-and-forget: the caller shouldn't wait on this, and a silent failure
  // here must never interrupt the user-facing chat/run loop.
  const logLlmUsage = useCallback(async ({
    participantId, segment, segmentRefId,
    model, usage, costUsd,
  }) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    if (!usage) return;
    try {
      await supabase.from('llm_usage').insert({
        workshop_id: roomIdRef.current,
        participant_id: participantId || null,
        segment,
        segment_ref_id: segmentRefId || null,
        model,
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        cost_usd: costUsd,
      });
    } catch (err) {
      console.warn('logLlmUsage failed:', err?.message || err);
    }
  }, []);

  // Workshop-wide usage — every row tagged with this workshop, regardless
  // of which participant spent it. Stage 7b's primary view uses this so
  // the room sees the collective cost as pedagogy ("look how cheap a
  // full mixed-team workshop actually is").
  const loadWorkshopUsage = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase
      .from('llm_usage')
      .select('*')
      .eq('workshop_id', roomIdRef.current)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('loadWorkshopUsage:', error.message);
      return [];
    }
    return data || [];
  }, []);

  const subscribeToWorkshopUsage = useCallback((onInsert) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};
    // Unique channel name per subscription — two components (the Usage
    // tab and the header settings menu) subscribe to the same filter, and
    // Supabase's realtime client throws if two subscriptions share a
    // channel name once the first one is already subscribed.
    const chan = `llm-usage-workshop:${roomIdRef.current}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(chan)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'llm_usage',
        filter: `workshop_id=eq.${roomIdRef.current}`,
      }, (payload) => onInsert(payload.new))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // Load all workflow_run usage rows tagged with a given runId. Used by
  // the Observability run detail view to annotate each step with its cost.
  const loadRunUsage = useCallback(async (runId) => {
    if (!isSupabaseConfigured || !roomIdRef.current || !runId) return [];
    const { data, error } = await supabase
      .from('llm_usage')
      .select('*')
      .eq('workshop_id', roomIdRef.current)
      .eq('segment', 'workflow_run')
      .like('segment_ref_id', `${runId}:%`);
    if (error) {
      console.warn('loadRunUsage:', error.message);
      return [];
    }
    return data || [];
  }, []);

  const loadMyUsage = useCallback(async (participantId) => {
    if (!isSupabaseConfigured || !roomIdRef.current || !participantId) return [];
    const { data, error } = await supabase
      .from('llm_usage')
      .select('*')
      .eq('workshop_id', roomIdRef.current)
      .eq('participant_id', participantId)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('loadMyUsage:', error.message);
      return [];
    }
    return data || [];
  }, []);

  const subscribeToMyUsage = useCallback((participantId, onInsert) => {
    if (!isSupabaseConfigured || !roomIdRef.current || !participantId) return () => {};
    const chan = `llm-usage:${roomIdRef.current}:${participantId}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(chan)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'llm_usage',
          filter: `workshop_id=eq.${roomIdRef.current}`,
        },
        (payload) => {
          const row = payload.new;
          if (row?.participant_id !== participantId) return;
          onInsert(row);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // ===== Realtime: subscribe to all entity tables =====
  const subscribeToRoom = useCallback((handlers) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};

    const channel = supabase.channel(`room-sync:${roomIdRef.current}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'files', filter: `room_id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onFileChange) handlers.onFileChange(payload.eventType, payload.new, payload.old);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coworkers', filter: `room_id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onCoworkerChange) handlers.onCoworkerChange(payload.eventType, payload.new, payload.old);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tools', filter: `room_id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onToolChange) handlers.onToolChange(payload.eventType, payload.new, payload.old);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflows', filter: `room_id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onWorkflowChange) handlers.onWorkflowChange(payload.eventType, payload.new, payload.old);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'workflow_runs', filter: `room_id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onWorkflowRunChange) handlers.onWorkflowRunChange(payload.eventType, payload.new, payload.old);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'approvals', filter: `room_id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onApprovalChange) handlers.onApprovalChange(payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomIdRef.current}` }, (payload) => {
        if (handlers.onRoomChange) handlers.onRoomChange(payload.new, payload.old);
      })
      .subscribe();

    realtimeChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  }, []);

  // ===== Presence =====
  const trackPresence = useCallback((userName, userColor, onPresenceChange) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};
    if (presenceChannelRef.current) supabase.removeChannel(presenceChannelRef.current);

    const channel = supabase.channel(`presence:${roomIdRef.current}`, {
      config: { presence: { key: userName } },
    });
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const online = [];
      for (const [key, entries] of Object.entries(state)) {
        if (entries.length > 0) {
          online.push({ name: entries[0].name || key, color: entries[0].color || null, online: true });
        }
      }
      if (onPresenceChange) onPresenceChange(online);
    });
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await channel.track({ name: userName, color: userColor });
    });
    presenceChannelRef.current = channel;
    return () => { channel.untrack(); supabase.removeChannel(channel); presenceChannelRef.current = null; };
  }, []);

  const leavePresence = useCallback(() => {
    if (presenceChannelRef.current) {
      presenceChannelRef.current.untrack();
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current);
      if (presenceChannelRef.current) { presenceChannelRef.current.untrack(); supabase.removeChannel(presenceChannelRef.current); }
    };
  }, []);

  return {
    isConfigured: isSupabaseConfigured,
    // Auth
    getSession, getUser, signInWithGoogle, signInWithMagicLink,
    signOut, checkIsAdmin, onAuthStateChange,
    // Admin
    createWorkshop, loadAdminWorkshops, loadWorkshopParticipants,
    deleteWorkshop, deprecateWorkshop, revealStage, revealAllStages, loadWorkshopStats, loadWorkshopContent, loadWorkshopActivity,
    seedWorkshopContent, subscribeToWorkshopPresence,
    // Room
    joinRoom, getRoomId, setCreditAllocation, setParticipantCreditBonus,
    upsertParticipant, loadParticipants, findParticipantIdByName, getParticipantById, getCoworkerParticipantId,
    loadUserPreferences, saveUserPreferences, loadUserRole, saveUserRole,
    sendDm, fetchDmThread, subscribeToDms, subscribeToAllRoomDms,
    loadFiles, saveFile, deleteFile, saveFilesBatch,
    loadCoworkers, saveCoworker, deleteCoworker,
    loadTools, saveTool, deleteTool,
    loadWorkflows, saveWorkflow, deleteWorkflow,
    saveMessage, saveWorkflowRun, loadWorkflowRuns, loadApprovals, loadAllRoomApprovals, logToolCall, logApproval,
    logLlmUsage, loadMyUsage, subscribeToMyUsage,
    loadWorkshopUsage, subscribeToWorkshopUsage, loadRunUsage,
    subscribeToRoom, trackPresence, leavePresence,
  };
}
