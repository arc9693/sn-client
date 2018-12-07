import { ODataCollectionResponse, ODataParams, Repository } from '@sensenet/client-core'
import { ValueObserver } from '@sensenet/client-utils'
import { ActionModel, GenericContent, Group, User } from '@sensenet/default-content-types'
import { EventHub } from '@sensenet/repository-events'
import { Action, AnyAction } from 'redux'
import { InjectableAction } from 'redux-di-middleware'
import { changedContent } from '../../Actions'
import { arrayComparer } from '../../assets/helpers'
import { rootStateType } from '../../store/rootReducer'

const eventObservables: Array<ValueObserver<any>> = []

export const startLoading = (idOrPath: number | string) => ({
  type: 'DMS_USERSANDGROUPS_LOADING',
  idOrPath,
})

export const loadUser: <T extends User = User>(
  idOrPath: string | number,
  userOptions?: ODataParams<T>,
) => InjectableAction<rootStateType, Action> = <T extends User = User>(
  idOrPath: number | string,
  userOptions?: ODataParams<T>,
) => ({
  type: 'DMS_USERSANDGROUPS_LOAD_USER',
  inject: async options => {
    const prevState = options.getState().dms.usersAndGroups
    if (prevState.user.currentUser && prevState.user.currentUser.Id.toString() === idOrPath) {
      return
    }

    eventObservables.forEach(o => o.dispose())
    eventObservables.length = 0

    const eventHub = options.getInjectable(EventHub)

    options.dispatch(startLoading(idOrPath))

    try {
      const repository = options.getInjectable(Repository)
      const newUser = await repository.load<T>({
        idOrPath,
        oDataOptions: userOptions,
      })
      options.dispatch(setUser(newUser.d))
      const emitChange = (content: User) => {
        changedContent.push(content)
      }

      eventObservables.push(
        eventHub.onCustomActionExecuted.subscribe(() => {
          emitChange({ Id: newUser.d.Id } as User)
        }) as any,
        eventHub.onContentCreated.subscribe(value => emitChange(value.content)) as any,
        eventHub.onContentModified.subscribe(value => emitChange(value.content)) as any,
        eventHub.onContentMoved.subscribe(value => emitChange(value.content)) as any,
      )

      await Promise.all([
        (async () => {
          const ancestors = await repository.executeAction<undefined, ODataCollectionResponse<GenericContent>>({
            idOrPath: newUser.d.Id,
            method: 'GET',
            name: 'Ancestors',
            body: undefined,
            oDataOptions: {
              orderby: [['Path', 'asc']],
            },
          })
          options.dispatch(setAncestors([...ancestors.d.results, newUser.d]))
        })(),
        (async () => {
          const memberships = await repository.security.getParentGroups({
            contentIdOrPath: idOrPath,
            directOnly: false,
            oDataOptions: {
              select: ['Workspace', 'DisplayName', 'Type', 'Id', 'Path', 'Actions', 'Icon', 'Members'],
              expand: ['Workspace', 'Actions', 'Members'],
              filter: `isOf('Group')`,
            },
          })
          options.dispatch(setMemberships(memberships))
        })(),
      ])
    } catch (error) {
      options.dispatch(setError(error))
    } finally {
      options.dispatch(finishLoading())
    }
  },
})

export const setUser: <T extends User = User>(content: T) => Action & { content: T } = <T>(content: T) => ({
  type: 'DMS_USERSANDGROUPS_SET_USER',
  content,
})

export const setMemberships = (items: ODataCollectionResponse<GenericContent>) => ({
  type: 'DMS_USERSANDGROUPS_SET_MEMBERSHIPS',
  items,
})

export const setAncestors = <T extends GenericContent>(ancestors: T[]) => ({
  type: 'DMS_USERSANDGROUPS_SET_ANCESTORS',
  ancestors,
})

export const setError = (error?: any) => ({
  type: 'DMS_USERSANDGROUPS_SET_ERROR',
  error,
})

export const finishLoading = () => ({
  type: 'DMS_USERSANDGROUPS_FINISH_LOADING',
})

export const setGroupOptions = <T extends GenericContent>(odataOptions: ODataParams<T>) => ({
  type: 'DMS_USERSANDGROUPS_SET_GROUP_OPTIONS',
  odataOptions,
})

export const userIsAdmin = (userPath: string) =>
  ({
    type: 'DMS_USER_ISADMIN',
    inject: async options => {
      const repository = options.getInjectable(Repository)
      const payload = await repository.security.getParentGroups({
        contentIdOrPath: userPath,
        directOnly: false,
        oDataOptions: {
          select: 'Name',
        },
      })
      const groups = payload.d.results as Group[]
      const admin = groups.find(group => group.Name === 'DMSAdmins')
      options.dispatch(isAdmin(admin ? true : false))
    },
  } as InjectableAction<rootStateType, AnyAction>)

export const isAdmin = (admin: boolean = false) => ({
  type: 'DMS_USER_ISADMIN',
  admin,
})

export const setActive = <T extends GenericContent>(active?: T) => ({
  type: 'DMS_USERSANDGROUPS_SET_ACTIVE',
  active,
})

export const updateChildrenOptions = <T extends GenericContent>(o: ODataParams<T>) =>
  ({
    type: 'DMS_USERSANDGROUPS_UPDATE_CHILDREN_OPTIONS',
    inject: async options => {
      const currentState = options.getState()
      const repository = options.getInjectable(Repository)
      options.dispatch(
        startLoading(
          currentState.dms.usersAndGroups.user.currentUser ? currentState.dms.usersAndGroups.user.currentUser.Id : '',
        ),
      )
      try {
        const items = await repository.security.getParentGroups({
          contentIdOrPath: currentState.dms.usersAndGroups.user.currentUser
            ? currentState.dms.usersAndGroups.user.currentUser.Id
            : 0,
          directOnly: false,
          oDataOptions: {
            ...{
              select: ['Workspace', 'DisplayName', 'Type', 'Id', 'Path', 'Actions', 'Icon', 'Members'],
              expand: ['Workspace', 'Actions', 'Members'],
              filter: `isOf('Group')`,
            },
            ...(o as any),
          },
        })
        options.dispatch(setMemberships(items))
      } catch (error) {
        options.dispatch(setError(error))
      } finally {
        options.dispatch(finishLoading())
        options.dispatch(setChildrenOptions(o))
      }

      /** */
    },
  } as InjectableAction<rootStateType, Action> & { odataOptions: ODataParams<GenericContent> })

export const setChildrenOptions = <T extends GenericContent>(odataOptions: ODataParams<T>) => ({
  type: 'DMS_USERSANDGROUPS_SET_CHILDREN_OPTIONS',
  odataOptions,
})

export const removeMemberFromGroups = (contentIds: number[], groups: Group[]) =>
  ({
    type: 'DMS_USERSANDGROUPS_REMOVE_MEMBER',
    inject: async options => {
      const currentState = options.getState()
      const repository = options.getInjectable(Repository)
      options.dispatch(
        startLoading(
          currentState.dms.usersAndGroups.user.currentUser ? currentState.dms.usersAndGroups.user.currentUser.Id : '',
        ),
      )
      try {
        const remove = groups.map(async group => {
          return await repository.security.removeMembers(group.Id, contentIds)
        })
        await Promise.all(remove)
      } catch (error) {
        options.dispatch(setError(error))
      } finally {
        const comparedList: Group[] = arrayComparer(groups, currentState.dms.usersAndGroups.user.memberships.d.results)
        options.dispatch(updateGroupList({ d: { __count: comparedList.length, results: comparedList } }))
        options.dispatch(loadUser(contentIds[0]))
        options.dispatch(finishLoading())
        options.dispatch(getGroups(currentState.dms.usersAndGroups.user.memberships))
      }
    },
  } as InjectableAction<rootStateType, Action> & { odataOptions: ODataParams<GenericContent> })

export const selectGroup = (groups: GenericContent[] | GenericContent) => {
  return {
    type: 'DMS_USERSANDGROUPS_SELECT_GROUP',
    groups,
  }
}

export const deselectGroup = (id: number) => ({
  type: 'DMS_USERSANDGROUPS_DESELECT_GROUP',
  id,
})

export const getGroups = (memberships: ODataCollectionResponse<Group>) =>
  ({
    type: 'DMS_USERSANDGROUPS_GET_GROUPS',
    inject: async options => {
      const currentState = options.getState()
      const repository = options.getInjectable(Repository)
      options.dispatch(
        startLoading(
          currentState.dms.usersAndGroups.user.currentUser ? currentState.dms.usersAndGroups.user.currentUser.Id : '',
        ),
      )
      try {
        const groups = await repository.loadCollection({
          path: '/Root',
          oDataOptions: {
            query: '+TypeIs:Group',
            select: ['DisplayName', 'Path', 'Actions'] as any,
            expand: ['Actions'] as any,
          },
        })
        const comparedList: Group[] = arrayComparer(groups.d.results, memberships.d.results)
        const newGroups = {
          d: {
            __count: comparedList.length,
            results: comparedList.filter((group: Group) => {
              const actions = group.Actions as ActionModel[]
              return actions ? actions.find((action: ActionModel) => action.Name === 'Edit') : []
            }),
          },
        }
        options.dispatch(setGroups(newGroups))
      } catch (error) {
        options.dispatch(setError(error))
      } finally {
        options.dispatch(finishLoading())
      }
    },
  } as InjectableAction<rootStateType, Action> & { odataOptions: ODataParams<GenericContent> })

export const setGroups = (groups: ODataCollectionResponse<Group>) => ({
  type: 'DMS_USERSANDGROUPS_SET_GROUPS',
  groups,
})

export const searchGroups = (text: string) => ({
  type: 'DMS_USERSANDGROUPS_SEARCH_GROUPS',
  text,
})

export const clearSelection = () => ({
  type: 'DMS_USERSANDGROUPS_CLEAR_SELECTION',
})

export const addUserToGroups = (user: User, groups: Group[]) =>
  ({
    type: 'DMS_USERSANDGROUPS_ADD_USER_TO_GROUPS',
    inject: async options => {
      const currentState = options.getState()
      const repository = options.getInjectable(Repository) as Repository
      options.dispatch(
        startLoading(
          currentState.dms.usersAndGroups.user.currentUser ? currentState.dms.usersAndGroups.user.currentUser.Id : '',
        ),
      )
      try {
        const add = groups.map(async group => {
          return await repository.security.addMembers(group.Id, [user.Id])
        })
        await Promise.all(add)
      } catch (error) {
        options.dispatch(setError(error))
      } finally {
        options.dispatch(finishLoading())
        options.dispatch(loadUser(user.Id))
        const comparedList: Group[] = arrayComparer(groups, currentState.dms.usersAndGroups.user.memberships.d.results)
        options.dispatch(updateGroupList({ d: { __count: comparedList.length, results: comparedList } }))
      }
    },
  } as InjectableAction<rootStateType, Action> & { odataOptions: ODataParams<GenericContent> })

export const updateGroupList = (groups: ODataCollectionResponse<Group>) => ({
  type: 'DMS_USERSANDGROUPS_UPDATE_GROUPS',
  groups,
})