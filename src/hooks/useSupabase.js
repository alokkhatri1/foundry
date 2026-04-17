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

  const deleteWorkshop = useCallback(async (roomId) => {
    if (!isSupabaseConfigured) return;
    // Cascade delete handled by foreign keys
    const { error } = await supabase.from('rooms').delete().eq('id', roomId);
    if (error) console.error('[sb] deleteWorkshop:', error.message);
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
      supabase.from('files').select('id, name, type, parent_id').eq('room_id', roomId),
      supabase.from('coworkers').select('id, name, role, avatar, color, created_by, created_at').eq('room_id', roomId),
      supabase.from('workflows').select('id, name, steps, created_at').eq('room_id', roomId),
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
    deleteWorkshop, loadWorkshopStats, loadWorkshopContent, loadWorkshopActivity,
    seedWorkshopContent, subscribeToWorkshopPresence,
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
