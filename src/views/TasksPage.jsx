import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule } from '../contexts/ScheduleContext';
import { 
  createTask, 
  updateTask, 
  listenToMyTasks, 
  listenToDelegatedTasks, 
  listenToAllTasks 
} from '../services/taskService';
import { Plus, X, Search } from 'lucide-react';
import Badge from '../components/ui/Badge';
import { showToast } from '../components/ui/Toast';

export default function TasksPage() {
  const { user } = useAuth();
  const { uniqueBaseTeachers, disabledInstructors, instructorProfiles } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('my_tasks'); // my_tasks, delegated, master
  const [tasks, setTasks] = useState([]);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    assignee: '',
    priority: 'medium',
    dueDate: ''
  });

  // Determine the logged in user's instructor name
  const myProfile = instructorProfiles?.find(p => 
    p.id === user?.email || 
    p.linkedEmail === user?.email || 
    (p.nickname && p.nickname.toLowerCase() === user?.email?.split('@')[0].toLowerCase())
  );
  const myTeacherName = myProfile?.fullname || myProfile?.nickname || user?.email?.split('@')[0] || 'Unknown';

  // Fetch tasks based on active tab
  useEffect(() => {
    if (!user) return;
    
    let unsubscribe;
    const email = user.email || 'unknown';
    
    if (activeTab === 'my_tasks') {
      unsubscribe = listenToMyTasks(myTeacherName, (data) => setTasks(data));
    } else if (activeTab === 'delegated') {
      unsubscribe = listenToDelegatedTasks(email, (data) => setTasks(data));
    } else if (activeTab === 'master') {
      unsubscribe = listenToAllTasks((data) => setTasks(data));
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, activeTab, myTeacherName]);

  const handleDragStart = (e, taskId) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // necessary to allow dropping
  };

  const handleDrop = async (e, newStatus) => {
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;
    
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    
    try {
      await updateTask(taskId, { status: newStatus });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Error moving task', variant: 'error' });
    }
  };

  const submitNewTask = async (e) => {
    e.preventDefault();
    try {
      await createTask({
        ...newTask,
        assigner: user.email || 'Admin',
        status: 'pending'
      });
      setIsModalOpen(false);
      setNewTask({ title: '', description: '', assignee: '', priority: 'medium', dueDate: '' });
      showToast({ title: 'Task Assigned successfully', variant: 'success' });
    } catch (error) {
      console.error("Error creating task:", error);
      showToast({ title: 'Failed to assign task', variant: 'error' });
    }
  };

  // Group tasks by status
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const getPriorityColor = (p) => {
    if (p === 'high') return 'danger';
    if (p === 'medium') return 'warning';
    return 'success';
  };

  return (
    <section className="dashboard-view active">
      <div className="panel" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>To-Do List & Task Assignment</h2>
          <p className="subtext">Manage personal tasks and delegated follow-ups</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> Assign New Task
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button 
          className={`btn ${activeTab === 'my_tasks' ? 'btn-primary' : 'btn-sm'}`} 
          onClick={() => setActiveTab('my_tasks')}
          style={{ background: activeTab !== 'my_tasks' ? 'transparent' : '', color: activeTab !== 'my_tasks' ? 'var(--text-primary)' : '' }}
        >
          My Tasks
        </button>
        <button 
          className={`btn ${activeTab === 'delegated' ? 'btn-primary' : 'btn-sm'}`} 
          onClick={() => setActiveTab('delegated')}
          style={{ background: activeTab !== 'delegated' ? 'transparent' : '', color: activeTab !== 'delegated' ? 'var(--text-primary)' : '' }}
        >
          Delegated by Me
        </button>
        <button 
          className={`btn ${activeTab === 'master' ? 'btn-primary' : 'btn-sm'}`} 
          onClick={() => setActiveTab('master')}
          style={{ background: activeTab !== 'master' ? 'transparent' : '', color: activeTab !== 'master' ? 'var(--text-primary)' : '' }}
        >
          Master View (All Tasks)
        </button>
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* PENDING COLUMN */}
        <div 
          style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', minHeight: '400px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, 'pending')}
        >
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
            Pending <Badge>{pendingTasks.length}</Badge>
          </h3>
          {pendingTasks.map(task => (
            <TaskCard key={task.id} task={task} onDragStart={handleDragStart} getPriorityColor={getPriorityColor} />
          ))}
        </div>

        {/* IN PROGRESS COLUMN */}
        <div 
          style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', minHeight: '400px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, 'in-progress')}
        >
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
            In Progress <Badge variant="warning">{inProgressTasks.length}</Badge>
          </h3>
          {inProgressTasks.map(task => (
            <TaskCard key={task.id} task={task} onDragStart={handleDragStart} getPriorityColor={getPriorityColor} />
          ))}
        </div>

        {/* COMPLETED COLUMN */}
        <div 
          style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', minHeight: '400px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, 'completed')}
        >
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
            Completed <Badge variant="success">{completedTasks.length}</Badge>
          </h3>
          {completedTasks.map(task => (
            <TaskCard key={task.id} task={task} onDragStart={handleDragStart} getPriorityColor={getPriorityColor} />
          ))}
        </div>

      </div>

      {/* Create Task Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', width: '100%', maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Assign New Task</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X /></button>
            </div>
            
            <form onSubmit={submitNewTask} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="input-group">
                <label>Title</label>
                <input required type="text" value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} placeholder="e.g. Call parent of Ebenezer" />
              </div>
              
              <div className="input-group">
                <label>Description</label>
                <textarea rows="3" value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})} placeholder="Detailed instructions..." />
              </div>

              <div className="input-group">
                <label>Assignee</label>
                <select required value={newTask.assignee} onChange={e => setNewTask({...newTask, assignee: e.target.value})}>
                  <option value="" disabled>Select an Instructor...</option>
                  {[...uniqueBaseTeachers].filter(t => !disabledInstructors?.has(t)).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                  {/* Let's also add emails if needed, but for now names are easier */}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="input-group" style={{ flex: 1 }}>
                  <label>Priority</label>
                  <select value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value})}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div className="input-group" style={{ flex: 1 }}>
                  <label>Due Date</label>
                  <input type="date" required value={newTask.dueDate} onChange={e => setNewTask({...newTask, dueDate: e.target.value})} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                <button type="button" className="btn btn-sm" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Task</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </section>
  );
}

function TaskCard({ task, onDragStart, getPriorityColor }) {
  return (
    <div 
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      style={{
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        marginBottom: '1rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'grab',
        borderLeft: `4px solid var(--${getPriorityColor(task.priority)})`
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <Badge variant={getPriorityColor(task.priority)}>{task.priority}</Badge>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{task.dueDate}</span>
      </div>
      <h4 style={{ margin: '0 0 0.5rem 0' }}>{task.title}</h4>
      <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{task.description}</p>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
        <span><strong>For:</strong> {task.assignee}</span>
        <span><strong>From:</strong> {task.assigner.split('@')[0]}</span>
      </div>
    </div>
  );
}
