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
    // Direct redirect to Supabase OAuth endpoint
    const redirectTo = encodeURIComponent(window.location.origin);
    window.location.href = `${import.meta.env.VITE_SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}`;
  }, []);

  const signInWithLinkedin = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'linkedin_oidc' });
    if (error) console.error('[sb] LinkedIn sign-in:', error.message);
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
    const { data } = await supabase.from('admins').select('id').eq('id', userId).single();
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
      .insert({ code, org_name: orgName || name, admin_id: adminId })
      .select('id, code')
      .single();
    if (error) { console.error('[sb] createWorkshop:', error.message); return null; }
    return data;
  }, []);

  const loadAdminWorkshops = useCallback(async (adminId) => {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.from('rooms')
      .select('id, code, org_name, created_at')
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

  // ===== Room: create or join =====
  const joinRoom = useCallback(async (code, orgName) => {
    if (!isSupabaseConfigured) return null;
    const { data: room, error } = await supabase
      .from('rooms')
      .upsert({ code, org_name: orgName }, { onConflict: 'code' })
      .select('id')
      .single();
    if (error) { console.error('[sb] joinRoom:', error.message); return null; }
    roomIdRef.current = room.id;
    console.log('[sb] joined room:', room.id);
    return room.id;
  }, []);

  const getRoomId = useCallback(() => roomIdRef.current, []);

  // ===== Participant =====
  const upsertParticipant = useCallback(async (name, color) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('participants').upsert(
      { room_id: roomIdRef.current, name, color, online: true, last_seen_at: new Date().toISOString() },
      { onConflict: 'room_id,name' }
    );
  }, []);

  const loadParticipants = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data } = await supabase.from('participants').select('*').eq('room_id', roomIdRef.current);
    return (data || []).map(p => ({
      id: p.id, name: p.name, color: p.color, online: false,
      joinedAt: new Date(p.joined_at).getTime(), lastSeen: new Date(p.last_seen_at).getTime(),
    }));
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
    const rows = files.map(f => ({
      id: f.id, room_id: f.room_id || roomIdRef.current,
      parent_id: f.parent_id || null, name: f.name, type: f.type,
      content: f.content || null, sort_order: f.sort_order ?? 0,
      updated_at: new Date().toISOString(),
    }));
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
      created_by: cw.createdBy, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) console.error('[sb] saveCoworker:', error.message);
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
    getSession, getUser, signInWithGoogle, signInWithLinkedin, signInWithMagicLink,
    signOut, checkIsAdmin, onAuthStateChange,
    // Admin
    createWorkshop, loadAdminWorkshops, loadWorkshopParticipants,
    // Room
    joinRoom, getRoomId,
    upsertParticipant, loadParticipants,
    loadFiles, saveFile, deleteFile, saveFilesBatch,
    loadCoworkers, saveCoworker, deleteCoworker,
    loadTools, saveTool, deleteTool,
    loadWorkflows, saveWorkflow, deleteWorkflow,
    saveMessage, saveWorkflowRun, logToolCall, logApproval,
    subscribeToRoom, trackPresence, leavePresence,
  };
}
